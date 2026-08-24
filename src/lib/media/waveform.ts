import { createStore, del, get, set } from 'idb-keyval';
import { writable } from 'svelte/store';
import type { MediaItem } from '$lib/project/types';
import type { WorkerRequest, WorkerResponse } from './workers/waveform.worker';

// peaks are min/max pairs per bucket: peaks[2i] is the lowest sample in
// bucket i, peaks[2i + 1] the highest, both in -1..1

export const DEFAULT_PEAKS_PER_SECOND = 50;

const store = createStore('braincut-peaks', 'peaks');
const cache = new Map<string, Float32Array>();
const inflight = new Map<string, Promise<Float32Array>>();

// bumps whenever new peaks arrive, so clips subscribed to it redraw
export const peaksVersion = writable(0);

export function getPeaks(mediaId: string): Float32Array | null {
  return cache.get(mediaId) ?? null;
}

interface Pending {
  resolve: (peaks: Float32Array) => void;
  reject: (e: Error) => void;
  onProgress?: (value: number) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./workers/waveform.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    const job = pending.get(message.id);
    if (!job) return;
    if (message.type === 'progress') job.onProgress?.(message.value);
    else if (message.type === 'done') { pending.delete(message.id); job.resolve(message.peaks); }
    else { pending.delete(message.id); job.reject(new Error(message.message)); }
  };
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(new Error('The waveform worker crashed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function postRequest(message: WorkerRequest) {
  getWorker().postMessage(message);
}

export interface PeaksOptions {
  perSecond?: number;
  onProgress?: (value: number) => void;
  signal?: AbortSignal;
}

export function computePeaks(media: MediaItem, blob: Blob, opts: PeaksOptions = {}): Promise<Float32Array> {
  const perSecond = opts.perSecond ?? DEFAULT_PEAKS_PER_SECOND;
  const cached = cache.get(media.id);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(media.id);
  if (running) return running;

  const promise = (async () => {
    const key = `peaks:${media.id}:${perSecond}`;
    const stored = await get<Float32Array>(key, store).catch(() => undefined);
    if (stored) return stored;
    const peaks = await new Promise<Float32Array>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, onProgress: opts.onProgress });
      opts.signal?.addEventListener('abort', () => {
        if (!pending.has(id)) return;
        pending.delete(id);
        postRequest({ type: 'cancel', id });
        reject(new DOMException('Waveform cancelled', 'AbortError'));
      }, { once: true });
      postRequest({ type: 'compute', id, blob, perSecond });
    });
    set(key, peaks, store).catch(() => {});
    return peaks;
  })();

  inflight.set(media.id, promise);
  promise.then((peaks) => {
    cache.set(media.id, peaks);
    peaksVersion.update((v) => v + 1);
  }).catch(() => {}).finally(() => inflight.delete(media.id));
  return promise;
}

export async function forgetPeaks(mediaId: string, perSecond = DEFAULT_PEAKS_PER_SECOND): Promise<void> {
  cache.delete(mediaId);
  await del(`peaks:${mediaId}:${perSecond}`, store).catch(() => {});
  peaksVersion.update((v) => v + 1);
}
