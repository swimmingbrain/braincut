import { createStore, del, get, keys, set } from 'idb-keyval';

// proxies and converted copies live in the origin private file system.
// safari has opfs but no createWritable on the main thread, so there the
// bytes go into indexeddb under the same key instead
const fallback = createStore('braincut-files', 'files');

export function proxyKey(mediaId: string): string {
  return `proxy/${mediaId}.mp4`;
}

export function convertedKey(mediaId: string): string {
  return `converted/${mediaId}.mp4`;
}

async function root(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function directoryFor(key: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string } | null> {
  let dir = await root();
  if (!dir) return null;
  const parts = key.split('/');
  const name = parts.pop()!;
  try {
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  } catch {
    return null;
  }
  return { dir, name };
}

function canStream(): boolean {
  return typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype;
}

// a writable with positioned writes, like the real one, that keeps the
// bytes in memory and drops them into indexeddb when closed
function memoryStream(key: string): WritableStream<FileSystemWriteChunkType> {
  let buffer = new Uint8Array(1 << 20);
  let length = 0;
  let cursor = 0;

  const ensure = (end: number) => {
    if (end <= buffer.length) return;
    let size = buffer.length;
    while (size < end) size *= 2;
    const next = new Uint8Array(size);
    next.set(buffer.subarray(0, length));
    buffer = next;
  };

  const put = async (data: BufferSource | Blob | string | null | undefined, at: number) => {
    if (data === null || data === undefined) return;
    let bytes: Uint8Array;
    if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    else if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else bytes = new Uint8Array(data);
    ensure(at + bytes.length);
    buffer.set(bytes, at);
    length = Math.max(length, at + bytes.length);
    cursor = at + bytes.length;
  };

  return new WritableStream<FileSystemWriteChunkType>({
    async write(chunk) {
      if (chunk instanceof Blob || typeof chunk === 'string' || ArrayBuffer.isView(chunk) || chunk instanceof ArrayBuffer) {
        await put(chunk, cursor);
        return;
      }
      if (chunk.type === 'write') await put(chunk.data, chunk.position ?? cursor);
      else if (chunk.type === 'seek') cursor = chunk.position ?? 0;
      else if (chunk.type === 'truncate') { length = Math.min(length, chunk.size ?? 0); cursor = Math.min(cursor, length); }
    },
    async close() {
      await set(key, new Blob([buffer.slice(0, length)]), fallback);
    }
  });
}

export async function writeStream(key: string): Promise<WritableStream<FileSystemWriteChunkType>> {
  if (canStream()) {
    const target = await directoryFor(key, true);
    if (target) {
      const handle = await target.dir.getFileHandle(target.name, { create: true });
      return handle.createWritable({ keepExistingData: false });
    }
  }
  return memoryStream(key);
}

export async function writeBlob(key: string, blob: Blob): Promise<void> {
  const stream = await writeStream(key);
  const writer = stream.getWriter();
  try {
    await writer.write(blob);
  } finally {
    await writer.close();
  }
}

export async function readBlob(key: string): Promise<Blob | null> {
  const target = await directoryFor(key, false);
  if (target) {
    try {
      const handle = await target.dir.getFileHandle(target.name);
      return await handle.getFile();
    } catch {}
  }
  return (await get<Blob>(key, fallback)) ?? null;
}

export async function remove(key: string): Promise<void> {
  const target = await directoryFor(key, false);
  if (target) {
    try {
      await target.dir.removeEntry(target.name);
    } catch {}
  }
  await del(key, fallback).catch(() => {});
}

async function walk(dir: FileSystemDirectoryHandle, prefix: string, out: string[]) {
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') await walk(entry, path, out);
    else out.push(path);
  }
}

export async function list(): Promise<string[]> {
  const out: string[] = [];
  const dir = await root();
  if (dir) {
    try {
      await walk(dir, '', out);
    } catch {}
  }
  for (const key of await keys<string>(fallback).catch(() => [] as string[])) {
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

export async function estimateQuota(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return { usage: 0, quota: Infinity };
  const estimate = await navigator.storage.estimate();
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? Infinity };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (bytes >= 1 << 20) return `${Math.round(bytes / (1 << 20))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

// throws with a plain message when the browser wouldn't fit the file
export async function ensureRoom(bytes: number): Promise<void> {
  const { usage, quota } = await estimateQuota();
  if (usage + bytes > quota) {
    throw new Error(`Not enough browser storage: ${formatBytes(bytes)} needed, ${formatBytes(Math.max(0, quota - usage))} free`);
  }
}
