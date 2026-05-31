import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import type { MediaItem } from '$lib/project/types';

const MAX_BITMAPS = 400;
const MAX_SINKS = 4;
const MAX_CONCURRENT = 2;
const MAX_QUEUED = 6;
// times are bucketed so a scrub that lands a few ms away still hits the cache
const BUCKETS_PER_SECOND = 10;

function bucket(time: number): number {
  return Math.round(time * BUCKETS_PER_SECOND);
}

function cacheKey(mediaId: string, width: number, time: number): string {
  return `${mediaId}:${width}:${bucket(time)}`;
}

// bitmaps, oldest first. a map keeps insertion order, so touching an entry
// means deleting and re-adding it
const bitmaps = new Map<string, ImageBitmap>();

function remember(key: string, bitmap: ImageBitmap) {
  bitmaps.get(key)?.close();
  bitmaps.delete(key);
  bitmaps.set(key, bitmap);
  while (bitmaps.size > MAX_BITMAPS) {
    const oldest = bitmaps.keys().next().value!;
    bitmaps.get(oldest)?.close();
    bitmaps.delete(oldest);
  }
}

function recall(key: string): ImageBitmap | null {
  const bitmap = bitmaps.get(key);
  if (!bitmap) return null;
  bitmaps.delete(key);
  bitmaps.set(key, bitmap);
  return bitmap;
}

interface OpenSink {
  input: Input;
  sink: CanvasSink;
}

// open demuxers are expensive to set up and cheap to keep, a few stay
// around for the media being scrubbed right now
const sinks = new Map<string, OpenSink>();

async function openSink(media: MediaItem, blob: Blob, width: number): Promise<OpenSink | null> {
  const key = `${media.id}:${width}`;
  const existing = sinks.get(key);
  if (existing) {
    sinks.delete(key);
    sinks.set(key, existing);
    return existing;
  }
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack().catch(() => null);
  if (!track || !(await track.canDecode())) {
    input.dispose();
    return null;
  }
  const opened = { input, sink: new CanvasSink(track, { width, fit: 'contain', poolSize: 2, alpha: media.alpha }) };
  sinks.set(key, opened);
  while (sinks.size > MAX_SINKS) {
    const oldest = sinks.keys().next().value!;
    sinks.get(oldest)!.input.dispose();
    sinks.delete(oldest);
  }
  return opened;
}

function canvasToDataUrl(canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number): Promise<string> {
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d')!.drawImage(canvas, 0, 0, width, height);
  return Promise.resolve(out.toDataURL('image/jpeg', 0.72));
}

function scaled(media: MediaItem, width: number): { width: number; height: number } {
  const ratio = media.width > 0 && media.height > 0 ? media.height / media.width : 9 / 16;
  return { width, height: Math.max(1, Math.round(width * ratio)) };
}

export async function posterThumbnail(blob: Blob, media: MediaItem, opts: { width?: number } = {}): Promise<string | null> {
  const width = opts.width ?? 160;
  if (media.kind === 'audio' || !media.hasVideo) return null;
  const size = scaled(media, width);
  if (media.kind === 'image') {
    const bitmap = await createImageBitmap(blob, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' }).catch(() => null);
    if (!bitmap) return null;
    try {
      return await canvasToDataUrl(bitmapCanvas(bitmap), size.width, size.height);
    } finally {
      bitmap.close();
    }
  }
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new CanvasSink(track, { width: size.width, fit: 'contain' });
    // the first frame is often black or a logo, a bit into the file is safer
    const time = Math.min(media.duration * 0.1, 1);
    const wrapped = (await sink.getCanvas(time)) ?? (await sink.getCanvas(0));
    if (!wrapped) return null;
    return await canvasToDataUrl(wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height);
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}

function bitmapCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return canvas;
}

interface Job {
  media: MediaItem;
  blob: Blob;
  times: number[];
  width: number;
  resolve: (frames: (ImageBitmap | null)[]) => void;
}

const queued: Job[] = [];
let running = 0;

function fromCache(job: Job): (ImageBitmap | null)[] {
  return job.times.map((t) => recall(cacheKey(job.media.id, job.width, t)));
}

async function runJob(job: Job) {
  const frames = fromCache(job);
  const missing = job.times.filter((_, i) => frames[i] === null);
  if (missing.length) {
    try {
      const opened = await openSink(job.media, job.blob, job.width);
      if (opened) {
        const wanted = [...new Set(missing.map(bucket))].sort((a, b) => a - b).map((b) => b / BUCKETS_PER_SECOND);
        let i = 0;
        for await (const wrapped of opened.sink.canvasesAtTimestamps(wanted)) {
          const time = wanted[i++];
          if (!wrapped) continue;
          remember(cacheKey(job.media.id, job.width, time), await createImageBitmap(wrapped.canvas));
        }
      }
    } catch {}
  }
  job.resolve(fromCache(job));
}

function pump() {
  while (running < MAX_CONCURRENT && queued.length) {
    // the newest request is what the user is looking at right now
    const job = queued.pop()!;
    running++;
    runJob(job).finally(() => {
      running--;
      pump();
    });
  }
}

export function filmstripFrames(media: MediaItem, blob: Blob, opts: { times: number[]; width: number }): Promise<(ImageBitmap | null)[]> {
  return new Promise((resolve) => {
    const job: Job = { media, blob, times: opts.times, width: opts.width, resolve };
    const cached = fromCache(job);
    if (cached.every((f) => f !== null) || media.kind !== 'video' || !media.hasVideo) {
      resolve(cached);
      return;
    }
    queued.push(job);
    // stale requests answer with whatever is cached instead of decoding
    while (queued.length > MAX_QUEUED) {
      const stale = queued.shift()!;
      stale.resolve(fromCache(stale));
    }
    pump();
  });
}

export function getFilmstrip(media: MediaItem, blob: Blob, start: number, end: number, count: number, width: number): Promise<(ImageBitmap | null)[]> {
  const n = Math.max(1, count);
  const span = Math.max(0, end - start);
  const times = Array.from({ length: n }, (_, i) => Math.min(media.duration, start + (span * (i + 0.5)) / n));
  return filmstripFrames(media, blob, { times, width });
}

export function invalidate(mediaId: string): void {
  for (const key of [...bitmaps.keys()]) {
    if (key.startsWith(`${mediaId}:`)) {
      bitmaps.get(key)?.close();
      bitmaps.delete(key);
    }
  }
  for (const key of [...sinks.keys()]) {
    if (key.startsWith(`${mediaId}:`)) {
      sinks.get(key)!.input.dispose();
      sinks.delete(key);
    }
  }
}
