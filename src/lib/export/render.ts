import { AudioBufferSource, BufferTarget, CanvasSource, Output, Quality, StreamTarget, type Target } from 'mediabunny';
import { renderAudio } from '$lib/engine/audio-render';
import { ensureRoom, list as opfsList, readBlob, remove as opfsRemove, writeStream } from '$lib/media/opfs';
import type { Sequence } from '$lib/project/types';
import { downloadBlob } from './download';
import { exportGif } from './gif';
import { estimateSize, formatFor, mimeTypeFor, type ExportSettings } from './presets';
import { abortError, Eta, exportRange, openCache, openScene, throwIfAborted, yieldToBrowser, type GetMedia, type Scene } from './scene';

export type ExportTarget = { kind: 'download'; fileName: string } | { kind: 'handle'; handle: FileSystemFileHandle };

export interface ExportCallbacks {
  onProgress(progress: number, stage: string, eta: number | null): void;
  // things worth telling the user that don't stop the export
  onNote?(note: string): void;
  signal: AbortSignal;
}

// a download this big is a lot to ask of the browser even when the bytes
// come off disk, so the user is pointed at saving straight to a file
const downloadWarnBytes = 1.5e9;

// under this the file is built in memory, which puts the metadata at the
// front and costs a fraction of a second. a bigger one is written to a
// scratch file first, so the tab never has to hold the whole export at once
const streamToDiskBytes = 400e6;
const scratchPrefix = 'exports/';

// the scratch file has to outlive the export, the browser reads it while it
// saves the download. the next export is late enough to clear it away
async function clearScratch(): Promise<void> {
  const keys = await opfsList().catch(() => [] as string[]);
  await Promise.all(keys.filter((k) => k.startsWith(scratchPrefix)).map((k) => opfsRemove(k).catch(() => {})));
}

// a file system writable never reports itself as full, so the muxer would
// queue the whole export in memory while the disk catches up. one chunk of
// room is enough to keep the writes flowing and the queue short
function backpressured(target: WritableStream<FileSystemWriteChunkType>): WritableStream<FileSystemWriteChunkType> {
  const writer = target.getWriter();
  return new WritableStream<FileSystemWriteChunkType>(
    {
      write: (chunk) => writer.write(chunk),
      close: () => writer.close(),
      abort: (reason) => writer.abort(reason)
    },
    new CountQueuingStrategy({ highWaterMark: 1 })
  );
}

// a clip whose file has gone missing would come out as black picture and
// silence without a word, so the export stops and names the files instead
function missingFiles(sequence: Sequence, start: number, end: number, getMedia: GetMedia): string[] {
  const names = new Set<string>();
  for (const track of sequence.tracks) {
    if (track.hidden || track.muted) continue;
    for (const clip of track.clips) {
      if (!clip.enabled || !clip.mediaId) continue;
      if (clip.start >= end || clip.start + clip.duration <= start) continue;
      const media = getMedia(clip.mediaId);
      if (!media) names.add(clip.name);
      else if (media.status === 'missing') names.add(media.name);
    }
  }
  return [...names];
}

async function writeBlob(blob: Blob, target: ExportTarget): Promise<number> {
  if (target.kind === 'download') {
    downloadBlob(blob, target.fileName);
    return blob.size;
  }
  const writable = await target.handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return blob.size;
}

export async function exportSequence(
  sequence: Sequence,
  settings: ExportSettings,
  target: ExportTarget,
  callbacks: ExportCallbacks,
  getMedia: GetMedia
): Promise<{ bytes: number }> {
  const { signal, onProgress } = callbacks;
  throwIfAborted(signal);
  if (settings.container === 'png') throw new Error('A still image is exported with Export frame, not with the render dialog.');

  const { start, end } = exportRange(sequence, settings.range);
  const duration = end - start;
  if (duration <= 0) throw new Error("There's nothing to export, the sequence is empty.");

  const missing = missingFiles(sequence, start, end, getMedia);
  if (missing.length) {
    const list = missing.slice(0, 3).join(', ') + (missing.length > 3 ? ` and ${missing.length - 3} more` : '');
    throw new Error(`Some clips point at files that are not there any more: ${list}. Relink them in the project panel, then export again.`);
  }

  const estimated = estimateSize(settings, duration, sequence.sampleRate);
  if (target.kind === 'download' && estimated > downloadWarnBytes) {
    callbacks.onNote?.('This file will be large. Saving straight to disk is safer than a download for files over 1.5 GB.');
  }

  if (settings.container === 'gif') {
    const blob = await exportGif(sequence, settings, { onProgress, signal }, getMedia);
    throwIfAborted(signal);
    return { bytes: await writeBlob(blob, target) };
  }

  const wantVideo = settings.includeVideo && settings.container !== 'wav' && settings.videoCodec !== null;
  const wantAudio = settings.includeAudio && settings.audioCodec !== null;
  if (!wantVideo && !wantAudio) throw new Error('Nothing to export, both video and audio are switched off.');

  const inMemory = target.kind === 'download' && estimated <= streamToDiskBytes;
  if (target.kind === 'download') await clearScratch();
  const format = formatFor(settings.container, { fastStart: inMemory ? 'in-memory' : false });
  let writable: WritableStream<FileSystemWriteChunkType> | null = null;
  let bufferTarget: BufferTarget | null = null;
  let scratchKey: string | null = null;
  let outputTarget: Target;
  if (target.kind === 'handle') {
    writable = await target.handle.createWritable();
    outputTarget = new StreamTarget(writable, { chunked: true });
  } else if (inMemory) {
    bufferTarget = new BufferTarget();
    outputTarget = bufferTarget;
  } else {
    await ensureRoom(estimated);
    scratchKey = scratchPrefix + Date.now() + '-' + target.fileName;
    writable = backpressured(await writeStream(scratchKey));
    outputTarget = new StreamTarget(writable, { chunked: true });
  }
  const output = new Output({ format, target: outputTarget });

  const fps = settings.fps;
  const frames = Math.max(1, Math.round(duration * fps));
  let scene: Scene | null = null;
  let videoSource: CanvasSource | null = null;
  let audioSource: AudioBufferSource | null = null;

  if (wantVideo && settings.videoCodec) {
    scene = openScene(sequence, settings.width, settings.height, getMedia);
    videoSource = new CanvasSource(scene.canvas, {
      codec: settings.videoCodec,
      quality: settings.quality === 'custom' ? new Quality({ bitrate: settings.videoBitrate }) : new Quality(settings.quality),
      keyFrameInterval: settings.keyFrameInterval,
      hardwareAcceleration: settings.hardwareAcceleration,
      latencyMode: 'quality'
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
  }
  if (wantAudio && settings.audioCodec) {
    audioSource = new AudioBufferSource({
      codec: settings.audioCodec,
      quality: new Quality({ bitrate: settings.audioBitrate })
    });
    output.addAudioTrack(audioSource);
  }

  // video is the slow part, so progress leans on it when both run
  const videoWeight = videoSource && audioSource ? 0.85 : videoSource ? 1 : 0;
  let videoProgress = 0;
  let audioProgress = 0;
  const eta = new Eta(frames);
  const began = performance.now();
  const report = () => {
    const progress = videoWeight * videoProgress + (1 - videoWeight) * audioProgress;
    let remaining: number | null = null;
    if (videoSource) {
      remaining = eta.remaining(videoProgress * frames);
    } else if (audioProgress > 0.02) {
      remaining = ((performance.now() - began) / 1000) * ((1 - audioProgress) / audioProgress);
    }
    onProgress(progress, videoSource ? 'Rendering' : 'Rendering audio', remaining);
  };

  const renderVideo = async () => {
    if (!scene || !videoSource) return;
    for (let i = 0; i < frames; i++) {
      throwIfAborted(signal);
      await scene.render(start + i / fps);
      await videoSource.add(i / fps, 1 / fps);
      eta.tick();
      videoProgress = (i + 1) / frames;
      report();
      if (i % 3 === 2) await yieldToBrowser();
    }
    videoSource.close();
  };

  const renderAudioTrack = async () => {
    if (!audioSource) return;
    const source = audioSource;
    const cache = scene?.cache ?? openCache();
    try {
      await renderAudio(
        sequence,
        getMedia,
        cache,
        { start, end },
        sequence.sampleRate,
        (buffer: AudioBuffer) => source.add(buffer),
        signal,
        (p: number) => {
          audioProgress = p;
          report();
        }
      );
    } finally {
      if (!scene) cache.dispose();
    }
    source.close();
  };

  const fail = async (error: unknown) => {
    if (writable) await writable.abort().catch(() => {});
    if (scratchKey) await opfsRemove(scratchKey).catch(() => {});
    await output.cancel().catch(() => {});
    throw signal.aborted ? abortError() : error;
  };

  try {
    await output.start();
    await Promise.all([renderVideo(), renderAudioTrack()]);
    throwIfAborted(signal);
    onProgress(1, 'Finishing', 0);
    await output.finalize();
  } catch (error) {
    await fail(error);
  } finally {
    scene?.close();
  }

  if (target.kind === 'handle') return { bytes: (await target.handle.getFile()).size };
  if (scratchKey) {
    // the blob url points at the scratch file, so the bytes never come back
    // through memory on their way to the download
    const file = await readBlob(scratchKey);
    if (!file) throw new Error('The export produced no data.');
    downloadBlob(file, target.fileName);
    return { bytes: file.size };
  }
  const buffer = bufferTarget?.buffer;
  if (!buffer) throw new Error('The export produced no data.');
  downloadBlob(new Blob([buffer], { type: mimeTypeFor(settings.container) }), target.fileName);
  return { bytes: buffer.byteLength };
}
