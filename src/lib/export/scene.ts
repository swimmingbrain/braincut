import { Compositor } from '$lib/engine/compositor';
import { MediaCache } from '$lib/engine/media-cache';
import { getBlobForMedia } from '$lib/media/sources';
import { sequenceDuration } from '$lib/project/defaults';
import type { Id, MediaItem, Sequence } from '$lib/project/types';
import type { ExportSettings } from './presets';

export type GetMedia = (id: Id) => MediaItem | undefined;

// a compositor and a media cache of their own, so an export never fights the
// program monitor over decoders and always reads the original files
export interface Scene {
  compositor: Compositor;
  cache: MediaCache;
  // the frame the encoder reads: the compositor canvas, or a letterboxed
  // copy of it when the export frame is not the shape of the sequence
  canvas: HTMLCanvasElement;
  render(time: number): Promise<void>;
  close(): void;
}

export function openCache(): MediaCache {
  return new MediaCache({ getBlob: (media: MediaItem) => getBlobForMedia(media, { preferProxy: false }) });
}

export function openScene(sequence: Sequence, width: number, height: number, getMedia: GetMedia): Scene {
  const cache = openCache();
  // the sequence is drawn at its own aspect and fitted into the export frame,
  // which is how a 16:9 edit ends up centred in a vertical export
  const fit = Math.min(width / sequence.width, height / sequence.height);
  const compositor = new Compositor({ width: sequence.width, height: sequence.height, scale: fit });
  const ctx = { media: getMedia, frames: cache, mode: 'export' as const };
  const inner = compositor.canvas;
  const exact = inner.width === width && inner.height === height;

  let out: HTMLCanvasElement | null = null;
  let bars: CanvasRenderingContext2D | null = null;
  if (!exact) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    // without a 2d context there is nothing to draw the bars with, so the
    // export takes the compositor canvas as it is rather than a blank one
    if (context) {
      out = canvas;
      bars = context;
    }
  }
  const dx = Math.round((width - inner.width) / 2);
  const dy = Math.round((height - inner.height) / 2);

  return {
    compositor,
    cache,
    canvas: out ?? inner,
    async render(time) {
      await compositor.render(sequence, time, ctx);
      if (!bars || !out) return;
      bars.fillStyle = '#000000';
      bars.fillRect(0, 0, out.width, out.height);
      bars.drawImage(inner, dx, dy);
    },
    close() {
      compositor.destroy();
      cache.dispose();
    }
  };
}

export function exportRange(sequence: Sequence, range: ExportSettings['range']): { start: number; end: number } {
  const whole = { start: 0, end: sequenceDuration(sequence) };
  if (range === 'in-out' && sequence.inPoint !== null && sequence.outPoint !== null && sequence.outPoint > sequence.inPoint) {
    return { start: sequence.inPoint, end: sequence.outPoint };
  }
  return whole;
}

export function abortError(): Error {
  const error = new Error('Export cancelled');
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

// lets the browser paint progress between frames. a nested setTimeout is
// held back four milliseconds by the spec, which is real money once a frame
// costs twenty, so the turn is taken through a message instead
const yieldChannel = typeof MessageChannel === 'undefined' ? null : new MessageChannel();
const waiting: Array<() => void> = [];
if (yieldChannel) {
  yieldChannel.port1.onmessage = () => waiting.shift()?.();
  yieldChannel.port1.start();
}

export function yieldToBrowser(): Promise<void> {
  const channel = yieldChannel;
  if (!channel) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}

// frames per second over the last few seconds of work, not since the start,
// so the estimate follows a slow section instead of averaging it away
export class Eta {
  private stamps: number[] = [];
  private readonly window = 90;

  constructor(private readonly total: number) {}

  tick(): void {
    this.stamps.push(performance.now());
    if (this.stamps.length > this.window) this.stamps.shift();
  }

  remaining(done: number): number | null {
    if (this.stamps.length < 5) return null;
    const first = this.stamps[0];
    const last = this.stamps[this.stamps.length - 1];
    const perFrame = (last - first) / (this.stamps.length - 1);
    return Math.max(0, ((this.total - done) * perFrame) / 1000);
  }
}
