import { createStore, del, get, set } from 'idb-keyval';
import { edit, project } from '$lib/project/store';
import { get as read } from 'svelte/store';
import type { MediaItem, Project } from '$lib/project/types';
import { probeFile } from './probe';
import { readBlob } from './opfs';

// the project file only knows a media item by id. where the bytes actually
// come from lives here: a file handle when the browser gave us one, else
// the file object itself, which chromium and firefox can keep in indexeddb
export interface SourceRecord {
  blob: Blob | File | null;
  handle: FileSystemFileHandle | null;
  name: string;
  size: number;
}

interface StoredRecord {
  handle: FileSystemFileHandle | null;
  file: File | null;
  name: string;
  size: number;
}

const memory = new Map<string, SourceRecord>();
const store = createStore('braincut-media', 'sources');

export function registerSource(mediaId: string, source: { file?: File | Blob; handle?: FileSystemFileHandle }): void {
  const record: SourceRecord = {
    blob: source.file ?? null,
    handle: source.handle ?? null,
    name: source.file instanceof File ? source.file.name : source.handle?.name ?? '',
    size: source.file?.size ?? 0
  };
  memory.set(mediaId, record);
  const stored: StoredRecord = {
    handle: record.handle,
    // with a handle the file can be re-read any time, storing the file too
    // would only duplicate the bytes in the browser's blob storage
    file: record.handle ? null : source.file instanceof File ? source.file : null,
    name: record.name,
    size: record.size
  };
  set(mediaId, stored, store).catch(() => {});
}

export function hasSource(mediaId: string): boolean {
  return memory.has(mediaId);
}

export function sourceName(mediaId: string): string | null {
  return memory.get(mediaId)?.name ?? null;
}

async function fromHandle(handle: FileSystemFileHandle): Promise<File | null> {
  try {
    let state = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'granted';
    // requesting needs a user gesture, outside of one it just throws
    if (state === 'prompt' && handle.requestPermission) state = await handle.requestPermission({ mode: 'read' });
    if (state !== 'granted') return null;
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function getBlob(mediaId: string): Promise<Blob | null> {
  let record = memory.get(mediaId);
  if (!record) {
    const stored = await get<StoredRecord>(mediaId, store).catch(() => undefined);
    if (!stored) return null;
    record = { blob: stored.file, handle: stored.handle, name: stored.name, size: stored.size };
    memory.set(mediaId, record);
  }
  if (record.handle) {
    const file = await fromHandle(record.handle);
    if (file) {
      record.blob = file;
      return file;
    }
  }
  return record.blob;
}

// the original is what exports read. a proxy only stands in for preview,
// a converted copy stands in whenever the browser can't decode the original
export async function getBlobForMedia(media: MediaItem, opts: { preferProxy?: boolean } = {}): Promise<Blob | null> {
  if (opts.preferProxy && media.proxy) {
    const proxy = await readBlob(media.proxy.key);
    if (proxy) return proxy;
  }
  if (media.converted) {
    const converted = await readBlob(media.converted.key);
    if (converted) return converted;
  }
  return getBlob(media.id);
}

export async function restoreSources(p: Project): Promise<void> {
  const missing: string[] = [];
  for (const media of p.media) {
    const blob = await getBlob(media.id);
    const stillUsable = blob !== null || (media.converted !== null && (await readBlob(media.converted.key)) !== null);
    if (!stillUsable) missing.push(media.id);
  }
  if (!missing.length || read(project)?.id !== p.id) return;
  edit('mark missing media', (draft) => {
    for (const media of draft.media) {
      if (!missing.includes(media.id)) continue;
      media.status = 'missing';
      media.statusReason = memory.get(media.id)?.handle
        ? 'The file couldn\'t be read again, it may have moved or needs permission'
        : 'The file isn\'t available anymore, relink it to keep editing';
    }
  });
}

export async function relinkMedia(mediaId: string, source: File | FileSystemFileHandle): Promise<void> {
  const file = source instanceof File ? source : await source.getFile();
  registerSource(mediaId, source instanceof File ? { file } : { file, handle: source });
  const probe = await probeFile(file, file.name);
  edit('relink media', (draft) => {
    const media = draft.media.find((m) => m.id === mediaId);
    if (!media) return;
    media.fileSize = probe.fileSize;
    media.mimeType = probe.mimeType;
    media.container = probe.container;
    media.duration = probe.duration;
    media.width = probe.width;
    media.height = probe.height;
    media.fps = probe.fps;
    media.hasVideo = probe.hasVideo;
    media.hasAudio = probe.hasAudio;
    media.channels = probe.channels;
    media.sampleRate = probe.sampleRate;
    media.videoCodec = probe.videoCodec;
    media.audioCodec = probe.audioCodec;
    media.rotation = probe.rotation;
    media.alpha = probe.alpha;
    media.status = probe.status;
    media.statusReason = probe.statusReason;
    // a proxy of the old file shows the wrong pictures now
    media.proxy = null;
    media.converted = null;
  });
}

export async function forgetSource(mediaId: string): Promise<void> {
  memory.delete(mediaId);
  await del(mediaId, store).catch(() => {});
}
