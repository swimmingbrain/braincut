import { get } from 'svelte/store';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { preferences } from '$lib/stores/preferences';
import { addToast } from '$lib/stores/app';
import { edit } from '$lib/project/store';
import type { MediaItem } from '$lib/project/types';
import { convertedKey, ensureRoom, formatBytes, remove, writeBlob } from './opfs';
import { probeFile } from './probe';
import { invalidate } from './thumbnails';
import { forgetPeaks } from './waveform';

// ffmpeg.wasm keeps its whole file system in a 32-bit heap
const MAX_INPUT = 2 * 1024 ** 3;

export function ffmpegAvailable(): boolean {
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') return false;
  return get(preferences).ffmpegMirror.trim() !== '';
}

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

// the core is a few megabytes and only some files ever need it, so it's
// fetched the first time and cached by the service worker after that
async function loadFfmpeg(): Promise<FFmpeg> {
  if (instance?.loaded) return instance;
  if (loading) return loading;
  loading = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
    const mirror = get(preferences).ffmpegMirror.trim().replace(/\/$/, '');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL(`${mirror}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${mirror}/ffmpeg-core.wasm`, 'application/wasm')
    });
    instance = ffmpeg;
    return ffmpeg;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? 'bin' : name.slice(i + 1).toLowerCase();
}

function setStatus(mediaId: string, status: MediaItem['status'], reason?: string) {
  edit('convert media', (draft) => {
    const item = draft.media.find((m) => m.id === mediaId);
    if (!item) return;
    item.status = status;
    item.statusReason = reason;
  });
}

export async function convertForEditing(
  media: MediaItem,
  blob: Blob,
  onProgress?: (value: number) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!ffmpegAvailable()) {
    addToast('Converting is turned off. Set a mirror for the converter in the preferences to enable it.', 'warning', 6000);
    throw new Error('Converting is disabled');
  }
  if (blob.size > MAX_INPUT) {
    addToast(`${media.name} is ${formatBytes(blob.size)}, the converter can only handle files up to 2 GB.`, 'error', 8000);
    throw new Error('File too large to convert');
  }
  await ensureRoom(Math.round(blob.size / 2));

  const ffmpeg = await loadFfmpeg();
  const inputName = `input.${extension(media.name)}`;
  const outputName = 'output.mp4';
  const key = convertedKey(media.id);
  const audioOnly = media.kind === 'audio' || (media.videoCodec === null && media.audioCodec !== null);

  const args = audioOnly
    ? ['-i', inputName, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputName]
    : ['-i', inputName, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputName];

  const progress = ({ progress: value }: { progress: number }) => {
    onProgress?.(Math.max(0, Math.min(1, value)));
  };
  const onAbort = () => {
    ffmpeg.terminate();
    instance = null;
  };

  setStatus(media.id, 'converting', 'Converting to H.264');
  ffmpeg.on('progress', progress);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await blob.arrayBuffer()));
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`The converter gave up on this file (exit code ${code})`);
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string') throw new Error('The converter returned no data');
    const converted = new Blob([data.slice()], { type: 'video/mp4' });
    await ffmpeg.deleteFile(outputName).catch(() => {});
    await writeBlob(key, converted);

    const probe = await probeFile(converted, `${media.name}.mp4`);
    if (probe.status !== 'ready') throw new Error(probe.statusReason ?? 'The converted file can\'t be decoded either');

    invalidate(media.id);
    await forgetPeaks(media.id);
    edit('convert media', (draft) => {
      const item = draft.media.find((m) => m.id === media.id);
      if (!item) return;
      item.converted = { key };
      item.status = 'ready';
      item.statusReason = undefined;
      item.kind = probe.kind;
      item.duration = probe.duration;
      item.width = probe.width;
      item.height = probe.height;
      item.fps = probe.fps;
      item.hasVideo = probe.hasVideo;
      item.hasAudio = probe.hasAudio;
      item.channels = probe.channels;
      item.sampleRate = probe.sampleRate;
      item.rotation = probe.rotation;
      item.alpha = false;
      item.proxy = null;
    });
  } catch (e) {
    await remove(key).catch(() => {});
    if (signal?.aborted) {
      setStatus(media.id, 'unsupported', media.statusReason);
      throw new DOMException('Converting cancelled', 'AbortError');
    }
    setStatus(media.id, 'unsupported', e instanceof Error ? e.message : String(e));
    throw e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (instance === ffmpeg) {
      ffmpeg.off('progress', progress);
      await ffmpeg.deleteFile(inputName).catch(() => {});
    }
  }
}
