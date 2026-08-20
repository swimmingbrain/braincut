import { createStore, del, get, set } from 'idb-keyval';
import { get as read, writable, type Readable } from 'svelte/store';
import { dirty, edit, markSaved, project } from '$lib/project/store';
import type { MediaItem, MediaStatus, Project } from '$lib/project/types';
import { probeFile, type ProbeResult } from './probe';
import { readBlob } from './opfs';
import { addToast } from '$lib/stores/app';

// the project file only knows a media item by id. where the bytes actually
// come from lives here: a file handle when the browser gave us one, else
// the file object itself, which chromium and firefox can keep in indexeddb
export interface SourceRecord {
  blob: Blob | File | null;
  handle: FileSystemFileHandle | null;
  name: string;
  size: number;
  lastModified: number;
  relativePath: string | null;
}

interface StoredRecord {
  handle: FileSystemFileHandle | null;
  file: File | null;
  name: string;
  size: number;
  lastModified?: number;
  relativePath?: string | null;
}

// points at the item that registered a file, so a project opened from disk
// finds sources another project put there under a different media id
interface IdentityRecord {
  mediaId: string;
}

// with a handle the bytes can be read from disk again, so a copy in the
// browser would only double the storage. small files are worth copying
// anyway: reading a handle back needs permission again after a restart,
// a copy makes reopening the project silent
const COPY_LIMIT = 64 * 1024 * 1024;

const memory = new Map<string, SourceRecord>();
const store = createStore('braincut-media', 'sources');

// what an item said before it was marked missing, so granting access back
// doesn't turn a file the browser can't decode into a ready one
const prior = new Map<string, { status: MediaStatus; reason?: string }>();

// handles whose permission ended with the last session. asking needs a
// click, so the project panel offers one button for all of them at once
const locked = writable<Map<string, { handle: FileSystemFileHandle; name: string }>>(new Map());
export const needsPermission: Readable<Map<string, { handle: FileSystemFileHandle; name: string }>> = { subscribe: locked.subscribe };

function identityKeys(name: string, size: number, lastModified?: number): string[] {
  if (!name || !size) return [];
  const base = `id:${name.toLowerCase()}|${size}`;
  return lastModified ? [`${base}|${lastModified}`, base] : [base];
}

function keysForMedia(media: MediaItem): string[] {
  return identityKeys(media.fileName ?? media.name, media.fileSize, media.lastModified);
}

export function registerSource(
  mediaId: string,
  source: { file?: File | Blob; handle?: FileSystemFileHandle; relativePath?: string | null }
): void {
  const file = source.file instanceof File ? source.file : null;
  const record: SourceRecord = {
    blob: source.file ?? null,
    handle: source.handle ?? null,
    name: file?.name ?? source.handle?.name ?? '',
    size: source.file?.size ?? 0,
    lastModified: file?.lastModified ?? 0,
    relativePath: source.relativePath ?? null
  };
  memory.set(mediaId, record);
  const stored: StoredRecord = {
    handle: record.handle,
    file: file && (!record.handle || file.size <= COPY_LIMIT) ? file : null,
    name: record.name,
    size: record.size,
    lastModified: record.lastModified,
    relativePath: record.relativePath
  };
  set(mediaId, stored, store).catch(() => {});
  for (const key of identityKeys(record.name, record.size, record.lastModified)) {
    set(key, { mediaId } as IdentityRecord, store).catch(() => {});
  }
}

export function hasSource(mediaId: string): boolean {
  return memory.has(mediaId);
}

export function sourceName(mediaId: string): string | null {
  return memory.get(mediaId)?.name ?? null;
}

async function fromHandle(handle: FileSystemFileHandle, interactive: boolean): Promise<File | null> {
  try {
    const state = handle.queryPermission ? await handle.queryPermission({ mode: 'read' }) : 'granted';
    if (state === 'granted') return await handle.getFile();
    // requesting needs a user gesture, outside of one it only throws
    if (state !== 'prompt' || !interactive || !handle.requestPermission) return null;
    if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') return null;
    return await handle.getFile();
  } catch {
    return null;
  }
}

function toRecord(stored: StoredRecord): SourceRecord {
  return {
    blob: stored.file,
    handle: stored.handle,
    name: stored.name,
    size: stored.size,
    lastModified: stored.lastModified ?? 0,
    relativePath: stored.relativePath ?? null
  };
}

async function recordFor(mediaId: string, media?: MediaItem): Promise<SourceRecord | null> {
  const known = memory.get(mediaId);
  if (known) return known;
  const stored = await get<StoredRecord>(mediaId, store).catch(() => undefined);
  if (stored) {
    const record = toRecord(stored);
    memory.set(mediaId, record);
    return record;
  }
  // nothing under this id: the same file may sit here under another one
  if (!media) return null;
  for (const key of keysForMedia(media)) {
    const pointer = await get<IdentityRecord>(key, store).catch(() => undefined);
    if (!pointer?.mediaId || pointer.mediaId === mediaId) continue;
    const other = await get<StoredRecord>(pointer.mediaId, store).catch(() => undefined);
    if (!other) continue;
    const record = toRecord(other);
    memory.set(mediaId, record);
    // from now on it belongs to this item too
    set(mediaId, other, store).catch(() => {});
    return record;
  }
  return null;
}

async function readRecord(record: SourceRecord, interactive: boolean): Promise<Blob | null> {
  if (record.handle) {
    const file = await fromHandle(record.handle, interactive);
    if (file) {
      record.blob = file;
      return file;
    }
  }
  return record.blob;
}

export async function getBlob(mediaId: string): Promise<Blob | null> {
  const record = await recordFor(mediaId);
  return record ? readRecord(record, false) : null;
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
  const record = await recordFor(media.id, media);
  return record ? readRecord(record, false) : null;
}

function missingReason(record: SourceRecord | null): string {
  return record?.handle
    ? 'The file needs permission again, or it moved. Grant access or relink it'
    : 'The file isn\'t available anymore, relink it to keep editing';
}

export async function restoreSources(p: Project): Promise<void> {
  const wasDirty = read(dirty);
  const missing: string[] = [];
  const back: string[] = [];
  const waiting = new Map<string, { handle: FileSystemFileHandle; name: string }>();
  const reasons = new Map<string, string>();
  for (const media of p.media) {
    const record = await recordFor(media.id, media);
    const blob = record ? await readRecord(record, false) : null;
    const usable = blob !== null || (media.converted !== null && (await readBlob(media.converted.key)) !== null);
    if (usable) {
      // a project saved while a file was gone comes back to life here
      if (media.status === 'missing') back.push(media.id);
      continue;
    }
    missing.push(media.id);
    if (media.status !== 'missing') prior.set(media.id, { status: media.status, reason: media.statusReason });
    reasons.set(media.id, missingReason(record));
    if (record?.handle) waiting.set(media.id, { handle: record.handle, name: record.name || media.name });
  }
  locked.set(waiting);
  if ((!missing.length && !back.length) || read(project)?.id !== p.id) return;
  edit('check media', (draft) => {
    for (const media of draft.media) {
      if (missing.includes(media.id)) {
        media.status = 'missing';
        media.statusReason = reasons.get(media.id);
      } else if (back.includes(media.id)) {
        media.status = 'ready';
        media.statusReason = undefined;
      }
    }
  });
  // hooking the media back up is bookkeeping, not an edit worth saving
  if (!wasDirty) markSaved();
  if (missing.length) {
    addToast(`${missing.length} file${missing.length === 1 ? ' is' : 's are'} missing, the project panel can relink ${missing.length === 1 ? 'it' : 'them'}`, 'warning', 7000);
  }
}

// one click for every handle that lost its permission. it has to run inside
// a user gesture, that is the whole reason it exists
export async function grantAccess(): Promise<{ granted: number; total: number }> {
  const waiting = read(locked);
  const back: string[] = [];
  for (const [mediaId, entry] of waiting) {
    const record = await recordFor(mediaId);
    const file = await fromHandle(entry.handle, true);
    if (!file) continue;
    if (record) record.blob = file;
    back.push(mediaId);
  }
  const still = new Map(waiting);
  for (const mediaId of back) still.delete(mediaId);
  locked.set(still);
  if (back.length) {
    edit('media found again', (draft) => {
      for (const media of draft.media) {
        if (!back.includes(media.id)) continue;
        const before = prior.get(media.id);
        media.status = before?.status ?? 'ready';
        media.statusReason = before?.reason;
      }
    });
  }
  return { granted: back.length, total: waiting.size };
}

function applyProbe(media: MediaItem, probe: ProbeResult, file: File): void {
  media.fileSize = probe.fileSize;
  media.fileName = file.name;
  media.lastModified = file.lastModified;
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
}

function stopWaiting(mediaId: string): void {
  locked.update((map) => {
    if (!map.has(mediaId)) return map;
    const next = new Map(map);
    next.delete(mediaId);
    return next;
  });
}

export async function relinkMedia(mediaId: string, source: File | FileSystemFileHandle): Promise<void> {
  const file = source instanceof File ? source : await source.getFile();
  registerSource(mediaId, source instanceof File ? { file } : { file, handle: source });
  stopWaiting(mediaId);
  const probe = await probeFile(file, file.name);
  edit('relink media', (draft) => {
    const media = draft.media.find((m) => m.id === mediaId);
    if (media) applyProbe(media, probe, file);
  });
  // a single file picker gives no way to look at the folder around it, so
  // the rest of the missing files need one more pick
  const left = (read(project)?.media ?? []).filter((m) => m.status === 'missing').length;
  if (left) addToast(`${left} more file${left === 1 ? '' : 's'} still missing, Relink all points at their folder`, 'warning', 6000);
}

interface Candidate {
  file: File;
  handle: FileSystemFileHandle | null;
  path: string | null;
}

// the file a missing item most likely is: same name and size first, then the
// same name, then a file of exactly the same size whose duration matches
async function match(media: MediaItem, candidates: Candidate[], used: Set<Candidate>): Promise<Candidate | null> {
  const free = candidates.filter((c) => !used.has(c));
  const wanted = (media.fileName ?? media.name).toLowerCase();
  const byName = free.filter((c) => c.file.name.toLowerCase() === wanted);
  const sameSize = byName.find((c) => c.file.size === media.fileSize);
  if (sameSize) return sameSize;
  if (byName.length) return byName[0];
  if (!media.fileSize) return null;
  for (const candidate of free) {
    if (candidate.file.size !== media.fileSize) continue;
    if (media.duration <= 0) return candidate;
    const probe = await probeFile(candidate.file, candidate.file.name).catch(() => null);
    if (probe && Math.abs(probe.duration - media.duration) < 0.5) return candidate;
  }
  return null;
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: Candidate[]): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') await walk(entry, path, out);
    else out.push({ file: await entry.getFile(), handle: entry, path });
  }
}

// relinks every missing item at once, from one folder or one set of files
export async function relinkAll(input: File[] | FileSystemDirectoryHandle): Promise<{ relinked: number; total: number }> {
  const candidates: Candidate[] = [];
  if (Array.isArray(input)) {
    for (const file of input) {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || null;
      candidates.push({ file, handle: null, path });
    }
  } else {
    await walk(input, '', candidates);
  }
  const p = read(project);
  if (!p) return { relinked: 0, total: 0 };
  const missing = p.media.filter((m) => m.status === 'missing');
  const used = new Set<Candidate>();
  const hits: Array<{ mediaId: string; candidate: Candidate; probe: ProbeResult }> = [];
  for (const media of missing) {
    const candidate = await match(media, candidates, used);
    if (!candidate) continue;
    used.add(candidate);
    const probe = await probeFile(candidate.file, candidate.file.name).catch(() => null);
    if (!probe) continue;
    registerSource(media.id, { file: candidate.file, handle: candidate.handle ?? undefined, relativePath: candidate.path });
    stopWaiting(media.id);
    hits.push({ mediaId: media.id, candidate, probe });
  }
  if (hits.length) {
    edit('relink media', (draft) => {
      for (const hit of hits) {
        const media = draft.media.find((m) => m.id === hit.mediaId);
        if (!media) continue;
        applyProbe(media, hit.probe, hit.candidate.file);
        if (hit.candidate.path) media.relativePath = hit.candidate.path;
      }
    });
  }
  return { relinked: hits.length, total: missing.length };
}

// the folder the footage moved to, or the files themselves when the browser
// has no directory picker
function pickSources(): Promise<File[] | FileSystemDirectoryHandle | null> {
  const w = window as Window & { showDirectoryPicker?: (opts: { mode: string; id: string }) => Promise<FileSystemDirectoryHandle> };
  if (typeof w.showDirectoryPicker === 'function') {
    return w.showDirectoryPicker({ mode: 'read', id: 'braincut-media' }).catch(() => null);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    document.body.append(input);
    input.click();
  });
}

// what the relink all button does: pick once, fix everything that is there
export async function relinkMissing(): Promise<void> {
  const picked = await pickSources();
  if (!picked || (Array.isArray(picked) && !picked.length)) return;
  const { relinked, total } = await relinkAll(picked);
  if (!total) addToast('Nothing is missing right now', 'info');
  else if (!relinked) addToast('None of the missing files were in there', 'warning', 5000);
  else addToast(`Relinked ${relinked} of ${total} file${total === 1 ? '' : 's'}`, relinked === total ? 'success' : 'warning', 5000);
}

export async function forgetSource(mediaId: string): Promise<void> {
  const record = memory.get(mediaId);
  memory.delete(mediaId);
  stopWaiting(mediaId);
  await del(mediaId, store).catch(() => {});
  if (!record) return;
  for (const key of identityKeys(record.name, record.size, record.lastModified)) {
    const pointer = await get<IdentityRecord>(key, store).catch(() => undefined);
    if (pointer?.mediaId === mediaId) await del(key, store).catch(() => {});
  }
}
