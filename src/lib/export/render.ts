import { AudioBufferSource, BufferTarget, CanvasSource, Output, Quality, StreamTarget, type Target } from 'mediabunny';
import { renderAudio } from '$lib/engine/audio-render';
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

// a download has to sit in memory as one buffer before the browser gets it,
// past this size the tab is likely to fall over
const downloadWarnBytes = 1.5e9;

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

  if (target.kind === 'download' && estimateSize(settings, duration, sequence.sampleRate) > downloadWarnBytes) {
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

  const format = formatFor(settings.container, { fastStart: target.kind === 'handle' ? false : 'in-memory' });
  let writable: FileSystemWritableFileStream | null = null;
  let bufferTarget: BufferTarget | null = null;
  let outputTarget: Target;
  if (target.kind === 'handle') {
    writable = await target.handle.createWritable();
    outputTarget = new StreamTarget(writable, { chunked: true });
  } else {
    bufferTarget = new BufferTarget();
    outputTarget = bufferTarget;
  }
  const output = new Output({ format, target: outputTarget });

  const fps = settings.fps;
  const frames = Math.max(1, Math.round(duration * fps));
  let scene: Scene | null = null;
  let videoSource: CanvasSource | null = null;
  let audioSource: AudioBufferSource | null = null;

  if (wantVideo && settings.videoCodec) {
    scene = openScene(sequence, settings.width, settings.height, getMedia);
    videoSource = new CanvasSource(scene.compositor.canvas, {
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
  const buffer = bufferTarget?.buffer;
  if (!buffer) throw new Error('The export produced no data.');
  downloadBlob(new Blob([buffer], { type: mimeTypeFor(settings.container) }), target.fileName);
  return { bytes: buffer.byteLength };
}
