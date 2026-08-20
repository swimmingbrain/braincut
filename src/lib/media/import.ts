import { get } from 'svelte/store';
import { id } from '$lib/project/ids';
import { edit, project } from '$lib/project/store';
import type { MediaItem } from '$lib/project/types';
import { addToast, importProgress, renderStatus } from '$lib/stores/app';
import { probeFile } from './probe';
import { registerSource } from './sources';
import { posterThumbnail } from './thumbnails';

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ts', 'm2ts', 'mts', 'avi', 'wmv', 'flv', '3gp', 'mxf', 'mpg', 'mpeg'];
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'aac', 'm4a', 'aiff', 'aif', 'wma'];
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'tif', 'tiff'];
export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS];

const PICKER_TYPES: FilePickerAcceptType[] = [
  { description: 'Media', accept: { 'video/*': VIDEO_EXTENSIONS.map((e) => `.${e}`), 'audio/*': AUDIO_EXTENSIONS.map((e) => `.${e}`), 'image/*': IMAGE_EXTENSIONS.map((e) => `.${e}`) } }
];

export function isMediaFile(name: string, type = ''): boolean {
  if (/^(video|audio|image)\//.test(type)) return true;
  const i = name.lastIndexOf('.');
  return i !== -1 && MEDIA_EXTENSIONS.includes(name.slice(i + 1).toLowerCase());
}

export interface ImportEntry {
  file: File;
  handle: FileSystemFileHandle | null;
  // where the file sat inside the folder it came from, when we know
  path: string | null;
}

type Entry = ImportEntry;
export type ImportInput = File[] | FileSystemFileHandle[] | ImportEntry[] | DataTransfer;

const PROBE_CONCURRENCY = 2;

async function walkHandle(handle: FileSystemFileHandle | FileSystemDirectoryHandle, out: Entry[], prefix = '') {
  if (handle.kind === 'file') {
    const file = await handle.getFile();
    if (isMediaFile(file.name, file.type)) out.push({ file, handle, path: prefix ? `${prefix}/${handle.name}` : null });
    return;
  }
  for await (const child of handle.values()) {
    if (child.name.startsWith('.')) continue;
    await walkHandle(child, out, prefix ? `${prefix}/${handle.name}` : handle.name);
  }
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, out: Entry[]) {
  if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry);
    const path = entry.fullPath ? entry.fullPath.replace(/^\//, '') : null;
    if (isMediaFile(file.name, file.type)) out.push({ file, handle: null, path: path === file.name ? null : path });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries hands out at most a hundred at a time until it's empty
  for (;;) {
    const batch = await readEntries(reader);
    if (!batch.length) break;
    for (const child of batch) {
      if (child.name.startsWith('.')) continue;
      await walkEntry(child, out);
    }
  }
}

// everything about a DataTransfer must be read before the first await,
// the browser empties it as soon as the drop handler yields
function collectDrop(transfer: DataTransfer): Promise<Entry[]> {
  const out: Entry[] = [];
  const work: Promise<void>[] = [];
  const items = Array.from(transfer.items ?? []);
  if (items.length) {
    for (const item of items) {
      if (item.kind !== 'file') continue;
      if (item.getAsFileSystemHandle) {
        work.push(item.getAsFileSystemHandle().then((handle) => (handle ? walkHandle(handle as FileSystemFileHandle | FileSystemDirectoryHandle, out) : undefined)).catch(() => {}));
      } else {
        const entry = item.webkitGetAsEntry?.();
        if (entry) work.push(walkEntry(entry, out).catch(() => {}));
        else {
          const file = item.getAsFile();
          if (file && isMediaFile(file.name, file.type)) out.push({ file, handle: null, path: null });
        }
      }
    }
  } else {
    for (const file of Array.from(transfer.files)) {
      if (isMediaFile(file.name, file.type)) out.push({ file, handle: null, path: null });
    }
  }
  return Promise.all(work).then(() => out);
}

async function collect(input: ImportInput): Promise<Entry[]> {
  if (input instanceof DataTransfer) return collectDrop(input);
  const out: Entry[] = [];
  for (const item of input) {
    if (item instanceof File) {
      const path = (item as File & { webkitRelativePath?: string }).webkitRelativePath || null;
      if (isMediaFile(item.name, item.type)) out.push({ file: item, handle: null, path });
    } else if ('kind' in item) {
      // FileSystemHandle is not a global everywhere, the kind tells them apart
      await walkHandle(item as FileSystemFileHandle | FileSystemDirectoryHandle, out);
    } else {
      out.push(item);
    }
  }
  return out;
}

async function buildItem(entry: Entry, binId: string | null): Promise<MediaItem> {
  const mediaId = id();
  const base: MediaItem = {
    ...(await probeFile(entry.file, entry.file.name).catch((e: unknown) => ({
      name: entry.file.name, kind: 'video' as const, duration: 0, width: 0, height: 0, fps: null,
      hasVideo: false, hasAudio: false, channels: 0, sampleRate: 0,
      videoCodec: null, audioCodec: null, container: null,
      mimeType: entry.file.type, fileSize: entry.file.size, rotation: 0 as const, alpha: false,
      status: 'unsupported' as const, statusReason: `This file can't be read: ${e instanceof Error ? e.message : String(e)}`,
      proxy: null, converted: null
    }))),
    id: mediaId, binId, label: 'none', addedAt: Date.now(), thumbnail: null
  };
  // what it takes to find the same file again after the project is reopened
  base.fileName = entry.file.name;
  base.lastModified = entry.file.lastModified;
  if (entry.path) base.relativePath = entry.path;
  registerSource(mediaId, { file: entry.file, handle: entry.handle ?? undefined, relativePath: entry.path });
  if (base.status === 'ready') {
    base.thumbnail = await posterThumbnail(entry.file, base, { width: 160 }).catch(() => null);
  }
  return base;
}

function summarize(items: MediaItem[]) {
  const ready = items.filter((m) => m.status === 'ready');
  const unsupported = items.filter((m) => m.status === 'unsupported');
  if (ready.length) addToast(`${ready.length} file${ready.length === 1 ? '' : 's'} imported`, 'success');
  for (const item of unsupported.slice(0, 3)) {
    addToast(`${item.name} needs converting before it can be used${item.statusReason ? `: ${item.statusReason}` : ''}`, 'warning', 7000);
  }
  if (unsupported.length > 3) addToast(`${unsupported.length - 3} more files need converting`, 'warning', 7000);
}

export async function importFiles(
  input: ImportInput,
  opts: { binId?: string | null } = {}
): Promise<MediaItem[]> {
  if (!get(project)) {
    addToast('Open or create a project before importing media', 'warning');
    return [];
  }
  const entries = await collect(input);
  if (!entries.length) {
    addToast('No media files found', 'info');
    return [];
  }

  renderStatus.set('importing');
  importProgress.set({ done: 0, total: entries.length, name: entries[0].file.name });
  const items: MediaItem[] = new Array(entries.length);
  let next = 0;
  let done = 0;
  const binId = opts.binId ?? null;

  const worker = async () => {
    while (next < entries.length) {
      const index = next++;
      const entry = entries[index];
      importProgress.set({ done, total: entries.length, name: entry.file.name });
      items[index] = await buildItem(entry, binId);
      done++;
      importProgress.set({ done, total: entries.length, name: entry.file.name });
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, entries.length) }, worker));
  } finally {
    importProgress.set(null);
    renderStatus.set('idle');
  }

  edit('import media', (draft) => {
    draft.media.push(...items);
  });
  summarize(items);
  return items;
}

function inputFallback(opts: { directory?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = MEDIA_EXTENSIONS.map((e) => `.${e}`).join(',');
    if (opts.directory) input.setAttribute('webkitdirectory', '');
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    input.oncancel = () => {
      resolve([]);
      input.remove();
    };
    document.body.append(input);
    input.click();
  });
}

function aborted(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export async function pickFiles(opts: { binId?: string | null } = {}): Promise<MediaItem[]> {
  try {
    if ('showOpenFilePicker' in window) {
      const handles = await window.showOpenFilePicker({ multiple: true, types: PICKER_TYPES, id: 'braincut-media' });
      return importFiles(handles, opts);
    }
    return importFiles(await inputFallback(), opts);
  } catch (e) {
    if (aborted(e)) return [];
    throw e;
  }
}

export async function pickFolder(opts: { binId?: string | null } = {}): Promise<MediaItem[]> {
  try {
    if ('showDirectoryPicker' in window) {
      const dir = await window.showDirectoryPicker({ mode: 'read', id: 'braincut-media' });
      const entries: Entry[] = [];
      await walkHandle(dir, entries);
      return importFiles(entries, opts);
    }
    return importFiles(await inputFallback({ directory: true }), opts);
  } catch (e) {
    if (aborted(e)) return [];
    throw e;
  }
}
