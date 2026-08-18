import type { MediaItem } from '$lib/project/types';
import { MediaReader, type FrameHandle, type VideoCursor } from './media-reader';

export type FrameMode = 'scrub' | 'play' | 'export';

// what the compositor pulls pictures through. lane separates playback
// cursors of clips that share a media file, so a transition between two cuts
// of the same clip doesn't make one decoder jump back and forth
export interface FrameProvider {
  getFrame(media: MediaItem, sourceTime: number, mode: FrameMode, lane?: string): Promise<FrameHandle | null>;
  // why a media can't be shown, so the compositor can draw a placeholder
  // instead of a hole and the ui can say something useful once
  failure?(mediaId: string): string | undefined;
  // the picture decoded but the gpu would not take it
  reportUnusable?(mediaId: string, name: string, reason: string): void;
}

interface ReaderEntry {
  reader: MediaReader;
  used: number;
  // requests currently awaiting this reader, it must not be closed under them
  busy: number;
}

interface CursorEntry {
  cursor: VideoCursor;
  mediaId: string;
  used: number;
}

interface ImageEntry {
  bitmap: ImageBitmap;
  used: number;
}

// a cursor nobody asked for in this long is closed, its decoder freed
const CURSOR_IDLE = 3000;
// a failed open is not retried before this
const FAILURE_COOLDOWN = 5000;
const MAX_IMAGE_BYTES = 512 * 1024 * 1024;

export class MediaCache implements FrameProvider {
  private readonly maxReaders: number;
  private readonly getBlob: (media: MediaItem) => Promise<Blob | null>;
  private readonly readers = new Map<string, ReaderEntry>();
  private readonly opening = new Map<string, Promise<MediaReader | null>>();
  private readonly failed = new Map<string, number>();
  // media that cannot be decoded here at all, with the reason, kept for the
  // session so every later frame draws the placeholder without retrying
  private readonly broken = new Map<string, string>();
  private readonly onFailure?: (mediaId: string, reason: string) => void;
  private readonly cursors = new Map<string, CursorEntry>();
  private readonly images = new Map<string, ImageEntry>();
  private readonly imageLoads = new Map<string, Promise<ImageBitmap | null>>();
  private tick = 0;
  private disposed = false;

  constructor(opts: {
    maxReaders?: number;
    getBlob: (media: MediaItem) => Promise<Blob | null>;
    onFailure?: (mediaId: string, reason: string) => void;
  }) {
    this.maxReaders = Math.max(1, opts.maxReaders ?? 8);
    this.getBlob = opts.getBlob;
    this.onFailure = opts.onFailure;
  }

  failure(mediaId: string): string | undefined {
    return this.broken.get(mediaId);
  }

  // a relink, a conversion or an explicit reset gives the file another go
  clearFailure(mediaId?: string): void {
    if (mediaId === undefined) this.broken.clear();
    else this.broken.delete(mediaId);
  }

  private markBroken(media: MediaItem, e: unknown): void {
    this.reportUnusable(media.id, media.name, e instanceof Error ? e.message : String(e));
  }

  reportUnusable(mediaId: string, name: string, reason: string): void {
    if (this.broken.has(mediaId)) return;
    this.broken.set(mediaId, reason);
    console.warn(`[braincut] ${name} cannot be shown here: ${reason}`);
    this.onFailure?.(mediaId, reason);
  }

  async reader(media: MediaItem): Promise<MediaReader | null> {
    if (this.disposed) return null;
    const entry = this.readers.get(media.id);
    if (entry) {
      entry.used = ++this.tick;
      return entry.reader;
    }
    const pending = this.opening.get(media.id);
    if (pending) return pending;

    const failedAt = this.failed.get(media.id);
    if (failedAt !== undefined && performance.now() - failedAt < FAILURE_COOLDOWN) return null;

    const open = (async () => {
      // a file that is simply not there yet is retried after the cooldown,
      // one whose bytes are there but won't decode is remembered
      let haveBlob = false;
      try {
        const blob = await this.getBlob(media);
        if (!blob) throw new Error(`No file for ${media.name}`);
        haveBlob = true;
        const reader = await MediaReader.open(media, blob);
        if (this.disposed) {
          reader.close();
          return null;
        }
        this.readers.set(media.id, { reader, used: ++this.tick, busy: 0 });
        this.failed.delete(media.id);
        this.evictReaders();
        return reader;
      } catch (e) {
        this.failed.set(media.id, performance.now());
        if (haveBlob) this.markBroken(media, e);
        else console.warn(`[braincut] could not open ${media.name}:`, e);
        return null;
      } finally {
        this.opening.delete(media.id);
      }
    })();
    this.opening.set(media.id, open);
    return open;
  }

  private evictReaders(): void {
    while (this.readers.size > this.maxReaders) {
      let victim: string | null = null;
      let oldest = Infinity;
      for (const [id, entry] of this.readers) {
        if (entry.busy > 0) continue;
        if (entry.used < oldest) {
          oldest = entry.used;
          victim = id;
        }
      }
      if (victim === null) return;
      this.closeReader(victim);
    }
  }

  private closeReader(mediaId: string): void {
    const entry = this.readers.get(mediaId);
    if (!entry) return;
    this.readers.delete(mediaId);
    for (const [key, c] of this.cursors) {
      if (c.mediaId === mediaId) {
        c.cursor.close();
        this.cursors.delete(key);
      }
    }
    entry.reader.close();
  }

  async image(media: MediaItem): Promise<ImageBitmap | null> {
    if (this.disposed) return null;
    const entry = this.images.get(media.id);
    if (entry) {
      entry.used = ++this.tick;
      return entry.bitmap;
    }
    const pending = this.imageLoads.get(media.id);
    if (pending) return pending;

    const failedAt = this.failed.get(media.id);
    if (failedAt !== undefined && performance.now() - failedAt < FAILURE_COOLDOWN) return null;

    const load = (async () => {
      let haveBlob = false;
      try {
        const blob = await this.getBlob(media);
        if (!blob) throw new Error(`No file for ${media.name}`);
        haveBlob = true;
        const bitmap = await createImageBitmap(blob);
        if (this.disposed) {
          bitmap.close();
          return null;
        }
        this.images.set(media.id, { bitmap, used: ++this.tick });
        this.failed.delete(media.id);
        this.evictImages();
        return bitmap;
      } catch (e) {
        this.failed.set(media.id, performance.now());
        if (haveBlob) this.markBroken(media, e);
        else console.warn(`[braincut] could not decode ${media.name}:`, e);
        return null;
      } finally {
        this.imageLoads.delete(media.id);
      }
    })();
    this.imageLoads.set(media.id, load);
    return load;
  }

  private imageBytes(): number {
    let bytes = 0;
    for (const e of this.images.values()) bytes += e.bitmap.width * e.bitmap.height * 4;
    return bytes;
  }

  private evictImages(): void {
    while (this.images.size > 1 && this.imageBytes() > MAX_IMAGE_BYTES) {
      let victim: string | null = null;
      let oldest = Infinity;
      for (const [id, e] of this.images) {
        if (e.used < oldest) {
          oldest = e.used;
          victim = id;
        }
      }
      if (victim === null) return;
      this.images.get(victim)!.bitmap.close();
      this.images.delete(victim);
    }
  }

  async getFrame(media: MediaItem, sourceTime: number, mode: FrameMode, lane = ''): Promise<FrameHandle | null> {
    if (this.disposed) return null;
    if (this.broken.has(media.id)) return null;
    try {
      return await this.decodeFrame(media, sourceTime, mode, lane);
    } catch (e) {
      this.markBroken(media, e);
      return null;
    }
  }

  private async decodeFrame(media: MediaItem, sourceTime: number, mode: FrameMode, lane: string): Promise<FrameHandle | null> {
    if (media.kind === 'image') {
      const bitmap = await this.image(media);
      if (!bitmap) return null;
      // the cache owns the bitmap, releasing a handle is a no-op
      return { image: bitmap, width: bitmap.width, height: bitmap.height, timestamp: 0, release: () => {} };
    }
    if (media.kind !== 'video') return null;

    const reader = await this.reader(media);
    if (!reader || !reader.hasVideo) return null;
    const entry = this.readers.get(media.id);
    if (entry) entry.busy++;
    try {
      if (mode === 'play') {
        const key = `${media.id}:${lane}`;
        let c = this.cursors.get(key);
        if (!c) {
          c = { cursor: reader.cursor(), mediaId: media.id, used: 0 };
          this.cursors.set(key, c);
        }
        c.used = performance.now();
        this.sweepCursors();
        return await c.cursor.frameAt(sourceTime);
      }
      return await reader.frameAt(sourceTime, lane);
    } finally {
      if (entry) entry.busy--;
    }
  }

  private sweepCursors(): void {
    const now = performance.now();
    for (const [key, c] of this.cursors) {
      if (now - c.used > CURSOR_IDLE) {
        c.cursor.close();
        this.cursors.delete(key);
      }
    }
  }

  // keeps a reader from being evicted while a long read, an audio stream
  // for one, is going on. the returned function lets go of it
  hold(mediaId: string): () => void {
    const entry = this.readers.get(mediaId);
    if (!entry) return () => {};
    entry.busy++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      entry.busy--;
    };
  }

  // warms the decoder for a clip that is about to be needed, e.g. the next
  // clip on the timeline while the current one plays
  prefetch(media: MediaItem, sourceTime: number, lane = ''): void {
    if (this.disposed) return;
    void this.getFrame(media, sourceTime, 'play', lane).then((h) => h?.release()).catch(() => {});
  }

  release(mediaId?: string): void {
    if (mediaId === undefined) {
      for (const id of Array.from(this.readers.keys())) this.closeReader(id);
      for (const c of this.cursors.values()) c.cursor.close();
      this.cursors.clear();
      for (const e of this.images.values()) e.bitmap.close();
      this.images.clear();
      this.failed.clear();
      this.broken.clear();
      return;
    }
    this.closeReader(mediaId);
    const img = this.images.get(mediaId);
    if (img) {
      img.bitmap.close();
      this.images.delete(mediaId);
    }
    this.failed.delete(mediaId);
    this.broken.delete(mediaId);
  }

  stats(): { readers: number; cursors: number; images: number; imageBytes: number; frames: number } {
    let frames = 0;
    for (const e of this.readers.values()) frames += e.reader.stats().frames;
    return {
      readers: this.readers.size,
      cursors: this.cursors.size,
      images: this.images.size,
      imageBytes: this.imageBytes(),
      frames
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.release();
    this.disposed = true;
  }
}
