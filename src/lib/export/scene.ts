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
  render(time: number): Promise<void>;
  close(): void;
}

export function openCache(): MediaCache {
  return new MediaCache({ getBlob: (media: MediaItem) => getBlobForMedia(media, { preferProxy: false }) });
}

export function openScene(sequence: Sequence, width: number, height: number, getMedia: GetMedia): Scene {
  const cache = openCache();
  const compositor = new Compositor({ width, height, scale: 1 });
  const ctx = { media: getMedia, frames: cache, mode: 'export' as const };
  return {
    compositor,
    cache,
    render: (time) => compositor.render(sequence, time, ctx),
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

// lets the browser paint progress between frames
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
