import { ALL_FORMATS, BlobSource, Input, UnsupportedInputFormatError } from 'mediabunny';
import type { InputAudioTrack, InputVideoTrack } from 'mediabunny';
import type { MediaItem, MediaKind, Rotation } from '$lib/project/types';

export type ProbeResult = Omit<MediaItem, 'id' | 'binId' | 'label' | 'addedAt' | 'thumbnail'>;

// the rates a camera actually shoots at. measured rates drift a little
// because of timestamp rounding, so anything this close snaps to the real one
const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 120, 240];

export function roundFrameRate(measured: number): number {
  for (const rate of COMMON_RATES) {
    if (Math.abs(measured - rate) <= 0.02) return rate;
  }
  return Math.round(measured * 1000) / 1000;
}

const CODEC_NAMES: Record<string, string> = {
  avc: 'H.264', hevc: 'HEVC', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', prores: 'ProRes',
  aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3', eac3: 'E-AC-3', dts: 'DTS'
};

export function codecName(codec: string | null): string {
  if (!codec) return 'unknown';
  if (CODEC_NAMES[codec]) return CODEC_NAMES[codec];
  if (codec.startsWith('pcm')) return 'PCM';
  return codec;
}

function extension(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

function empty(name: string, kind: MediaKind, mimeType: string, fileSize: number): ProbeResult {
  return {
    name, kind, duration: 0, width: 0, height: 0, fps: null,
    hasVideo: false, hasAudio: false, channels: 0, sampleRate: 0,
    videoCodec: null, audioCodec: null, container: null,
    mimeType, fileSize, rotation: 0, alpha: false,
    status: 'ready', proxy: null, converted: null
  };
}

export async function probeFile(file: File | Blob, name: string): Promise<ProbeResult> {
  const mime = file.type || '';
  const ext = extension(name);
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'tif', 'tiff'].includes(ext)) {
    return probeImage(file, name, mime || `image/${ext === 'svg' ? 'svg+xml' : ext === 'jpg' ? 'jpeg' : ext}`);
  }
  return probeContainer(file, name, mime);
}

async function probeImage(file: Blob, name: string, mime: string): Promise<ProbeResult> {
  const result = empty(name, 'image', mime, file.size);
  result.alpha = /png|webp|gif|svg|avif/.test(mime);
  try {
    const size = await imageSize(file);
    result.width = size.width;
    result.height = size.height;
    result.hasVideo = true;
    result.container = mime.replace('image/', '').replace('svg+xml', 'svg');
  } catch {
    result.status = 'unsupported';
    result.statusReason = 'This image can\'t be decoded by this browser';
  }
  return result;
}

// createImageBitmap refuses svgs without an intrinsic size, an <img> is
// happy to lay them out for us
async function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    if (size.width > 0 && size.height > 0) return size;
  } catch {}
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth || 512, height: img.naturalHeight || 512 };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function probeContainer(file: Blob, name: string, mime: string): Promise<ProbeResult> {
  const guessedKind: MediaKind = mime.startsWith('audio/') ? 'audio' : 'video';
  const result = empty(name, guessedKind, mime, file.size);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    const format = await input.getFormat();
    result.container = format.name;
    result.mimeType = await input.getMimeType().catch(() => mime) || mime;

    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) {
      result.status = 'unsupported';
      result.statusReason = 'No video or audio track was found in this file';
      return result;
    }

    const reasons: string[] = [];
    if (video) await readVideo(video, result, reasons);
    if (audio) await readAudio(audio, result, reasons);
    result.kind = result.hasVideo || video ? 'video' : 'audio';

    const tracks = [video, audio].filter((t): t is InputVideoTrack | InputAudioTrack => t !== null);
    result.duration = await input.computeDuration(tracks).catch(async () => (await input.getDurationFromMetadata(tracks)) ?? 0);

    // a file where nothing can be decoded is useless in the timeline until
    // it's converted, one with a dead audio track can still be cut silently
    const videoDead = video !== null && !result.hasVideo;
    const audioDead = audio !== null && !result.hasAudio;
    if ((video && videoDead) || (!video && audioDead)) {
      result.status = 'unsupported';
      result.statusReason = reasons.join(', ');
    } else if (reasons.length) {
      result.statusReason = reasons.join(', ');
    }
    return result;
  } catch (e) {
    result.status = 'unsupported';
    result.statusReason = e instanceof UnsupportedInputFormatError
      ? `${extension(name).toUpperCase() || 'This'} files can't be read directly, they need converting first`
      : `This file can't be read: ${e instanceof Error ? e.message : String(e)}`;
    return result;
  } finally {
    input.dispose();
  }
}

async function readVideo(track: InputVideoTrack, result: ProbeResult, reasons: string[]) {
  const codec = await track.getCodec();
  result.videoCodec = codec;
  result.rotation = (await track.getRotation()) as Rotation;
  result.width = await track.getDisplayWidth();
  result.height = await track.getDisplayHeight();
  result.alpha = await track.canBeTransparent().catch(() => false);
  try {
    const metrics = await track.computeFrameRateMetrics();
    result.fps = roundFrameRate(metrics.bestGuessFrameRate);
  } catch {
    result.fps = null;
  }
  const decodable = codec !== null && (await track.canDecode().catch(() => false));
  result.hasVideo = decodable;
  if (!decodable) {
    reasons.push(codec
      ? `${codecName(codec)} video can't be decoded by this browser`
      : 'The video codec isn\'t recognised');
  }
}

async function readAudio(track: InputAudioTrack, result: ProbeResult, reasons: string[]) {
  const codec = await track.getCodec();
  result.audioCodec = codec;
  result.channels = await track.getNumberOfChannels();
  result.sampleRate = await track.getSampleRate();
  const decodable = codec !== null && (await track.canDecode().catch(() => false));
  result.hasAudio = decodable;
  if (!decodable) {
    reasons.push(codec
      ? `${codecName(codec)} audio can't be decoded by this browser`
      : 'The audio codec isn\'t recognised');
  }
}
