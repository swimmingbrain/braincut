import { ALL_FORMATS, BlobSource, Conversion, ConversionCanceledError, Input, Mp4OutputFormat, Output, QUALITY_MEDIUM, StreamTarget } from 'mediabunny';
import { writable } from 'svelte/store';
import { edit } from '$lib/project/store';
import type { MediaItem } from '$lib/project/types';
import { ensureRoom, proxyKey, remove, writeStream } from './opfs';
import { invalidate } from './thumbnails';

// mediaId → 0..1 while a proxy is being made
export const proxyStatus = writable<Map<string, number>>(new Map());

function setProgress(mediaId: string, value: number | null) {
  proxyStatus.update((map) => {
    const next = new Map(map);
    if (value === null) next.delete(mediaId);
    else next.set(mediaId, value);
    return next;
  });
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function proxySize(media: MediaItem, height: number): { width: number; height: number } {
  // never scale up, a proxy is only worth having when it's smaller
  const h = even(Math.min(height, media.height || height));
  const ratio = media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9;
  return { width: even(h * ratio), height: h };
}

export async function createProxy(
  media: MediaItem,
  blob: Blob,
  opts: { height?: number } = {},
  onProgress?: (value: number) => void,
  signal?: AbortSignal
): Promise<void> {
  if (media.kind !== 'video' || !media.hasVideo) throw new Error('Only video gets a proxy');
  const size = proxySize(media, opts.height ?? 540);
  // a medium h.264 proxy lands well under a tenth of most camera files
  await ensureRoom(Math.round(blob.size / 8));

  const key = proxyKey(media.id);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const writable = await writeStream(key);
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable, { chunked: true })
  });

  setProgress(media.id, 0);
  try {
    const conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { height: size.height, width: size.width, fit: 'contain', codec: 'avc', quality: QUALITY_MEDIUM, alpha: 'discard' },
      audio: media.hasAudio ? { codec: 'aac', bitrate: 128_000 } : { discard: true }
    });
    if (!conversion.isValid) throw new Error('This file can\'t be turned into a proxy by this browser');
    conversion.onProgress = (value) => {
      setProgress(media.id, value);
      onProgress?.(value);
    };
    const onAbort = () => void conversion.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    invalidate(media.id);
    edit('create proxy', (draft) => {
      const item = draft.media.find((m) => m.id === media.id);
      if (item) item.proxy = { key, width: size.width, height: size.height };
    });
  } catch (e) {
    await remove(key).catch(() => {});
    if (e instanceof ConversionCanceledError) throw new DOMException('Proxy cancelled', 'AbortError');
    throw e;
  } finally {
    input.dispose();
    setProgress(media.id, null);
  }
}

export async function removeProxy(media: MediaItem): Promise<void> {
  if (!media.proxy) return;
  await remove(media.proxy.key);
  invalidate(media.id);
  edit('remove proxy', (draft) => {
    const item = draft.media.find((m) => m.id === media.id);
    if (item) item.proxy = null;
  });
}
