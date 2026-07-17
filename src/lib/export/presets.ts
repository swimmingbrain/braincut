import {
  canEncodeAudio,
  canEncodeVideo,
  MkvOutputFormat,
  MovOutputFormat,
  Mp4OutputFormat,
  WavOutputFormat,
  WebMOutputFormat,
  type AudioCodec,
  type OutputFormat,
  type VideoCodec
} from 'mediabunny';
import type { Sequence } from '$lib/project/types';

export type Container = 'mp4' | 'webm' | 'mov' | 'mkv' | 'gif' | 'wav' | 'png';
export type ExportVideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8';
export type ExportAudioCodec = 'aac' | 'opus' | 'pcm-s16' | 'flac';
export type QualityLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high' | 'custom';

export interface ExportSettings {
  container: Container;
  videoCodec: ExportVideoCodec | null;
  audioCodec: ExportAudioCodec | null;
  width: number;
  height: number;
  fps: number;
  quality: QualityLevel;
  // bits per second, only used when quality is 'custom'
  videoBitrate: number;
  audioBitrate: number;
  range: 'sequence' | 'in-out';
  includeVideo: boolean;
  includeAudio: boolean;
  hardwareAcceleration: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  // seconds between key frames
  keyFrameInterval: number;
  gif: { fps: number; width: number; dither: boolean; loop: boolean };
}

// presets leave size and frame rate open so they can follow the sequence
type Match = number | 'match';
export interface ExportPreset {
  id: string;
  name: string;
  description: string;
  // the browser has to be able to encode this codec for the preset to show up
  requires?: ExportVideoCodec;
  settings: Omit<ExportSettings, 'width' | 'height' | 'fps'> & { width: Match; height: Match; fps: Match };
}

const base: ExportPreset['settings'] = {
  container: 'mp4',
  videoCodec: 'avc',
  audioCodec: 'aac',
  width: 'match',
  height: 'match',
  fps: 'match',
  quality: 'high',
  videoBitrate: 12_000_000,
  audioBitrate: 192_000,
  range: 'sequence',
  includeVideo: true,
  includeAudio: true,
  hardwareAcceleration: 'no-preference',
  keyFrameInterval: 2,
  gif: { fps: 15, width: 480, dither: true, loop: true }
};

export const presets: ExportPreset[] = [
  {
    id: 'match',
    name: 'Match sequence',
    description: 'H.264 MP4 at the size and frame rate of the sequence',
    settings: { ...base }
  },
  {
    id: 'youtube-1080',
    name: 'YouTube 1080p',
    description: 'H.264 MP4, 1920x1080, AAC 192 kbps',
    settings: { ...base, width: 1920, height: 1080 }
  },
  {
    id: 'youtube-2160',
    name: 'YouTube 4K',
    description: 'H.264 MP4, 3840x2160, AAC 192 kbps',
    settings: { ...base, width: 3840, height: 2160, quality: 'very-high' }
  },
  {
    id: 'vertical-1080',
    name: 'Vertical 1080x1920',
    description: 'H.264 MP4 for shorts, reels and stories',
    settings: { ...base, width: 1080, height: 1920 }
  },
  {
    id: 'web-720',
    name: 'Web small 720p',
    description: 'H.264 MP4, 1280x720, medium quality, AAC 128 kbps',
    settings: { ...base, width: 1280, height: 720, quality: 'medium', audioBitrate: 128_000 }
  },
  {
    id: 'webm-vp9',
    name: 'WebM VP9 + Opus',
    description: 'VP9 video and Opus audio, plays in every browser',
    settings: { ...base, container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', audioBitrate: 128_000 }
  },
  {
    id: 'webm-av1',
    name: 'AV1 WebM',
    description: 'AV1 video and Opus audio, smallest files, slow to encode',
    requires: 'av1',
    settings: { ...base, container: 'webm', videoCodec: 'av1', audioCodec: 'opus', audioBitrate: 128_000 }
  },
  {
    id: 'hevc-mp4',
    name: 'HEVC MP4',
    description: 'H.265 video and AAC audio, about half the size of H.264',
    requires: 'hevc',
    settings: { ...base, videoCodec: 'hevc' }
  },
  {
    id: 'lossless-ish',
    name: 'Near lossless',
    description: 'H.264 MP4 at the highest quality with PCM audio',
    settings: { ...base, quality: 'very-high', audioCodec: 'pcm-s16' }
  },
  {
    id: 'gif',
    name: 'Animated GIF',
    description: '480px wide, 15 frames per second, no audio',
    settings: { ...base, container: 'gif', videoCodec: null, audioCodec: null, includeAudio: false, quality: 'medium' }
  },
  {
    id: 'wav',
    name: 'Audio only WAV',
    description: '16 bit PCM at the sample rate of the sequence',
    settings: { ...base, container: 'wav', videoCodec: null, audioCodec: 'pcm-s16', includeVideo: false }
  }
];

export function findPreset(id: string): ExportPreset | undefined {
  return presets.find((p) => p.id === id);
}

// h.264 rejects odd dimensions, the rest don't mind either way
export function roundEven(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function settingsFromPreset(preset: ExportPreset, sequence: Sequence): ExportSettings {
  const s = preset.settings;
  let width = s.width === 'match' ? sequence.width : s.width;
  let height = s.height === 'match' ? sequence.height : s.height;
  if (s.width !== 'match' && s.height !== 'match') {
    // a fixed size is a box: keep the sequence aspect inside it, and turn
    // the box around for a portrait sequence so the long sides line up
    const portrait = sequence.height > sequence.width;
    const boxW = portrait ? Math.min(s.width, s.height) : Math.max(s.width, s.height);
    const boxH = portrait ? Math.max(s.width, s.height) : Math.min(s.width, s.height);
    const k = Math.min(boxW / sequence.width, boxH / sequence.height);
    width = sequence.width * k;
    height = sequence.height * k;
  }
  return {
    ...s,
    width: roundEven(width),
    height: roundEven(height),
    fps: s.fps === 'match' ? sequence.fps : s.fps,
    gif: { ...s.gif }
  };
}

// codecs the browser can't encode should not offer their presets at all
export async function availablePresets(): Promise<ExportPreset[]> {
  const checks = await Promise.all(presets.map((p) => (p.requires ? canEncodeVideo(p.requires) : Promise.resolve(true))));
  return presets.filter((_, i) => checks[i]);
}

// bits per pixel per frame for h.264 at each quality level, the other codecs
// are scaled from there. rough on purpose, the point is a size people can plan with
const bitsPerPixel: Record<Exclude<QualityLevel, 'custom'>, number> = {
  'very-low': 0.02,
  low: 0.04,
  medium: 0.07,
  high: 0.12,
  'very-high': 0.2
};
const codecFactor: Record<ExportVideoCodec, number> = { avc: 1, hevc: 0.7, vp9: 0.7, av1: 0.55, vp8: 1.2 };

export function videoBitrateFor(settings: ExportSettings): number {
  if (settings.quality === 'custom') return settings.videoBitrate;
  const factor = settings.videoCodec ? codecFactor[settings.videoCodec] : 1;
  return settings.width * settings.height * settings.fps * bitsPerPixel[settings.quality] * factor;
}

export function estimateSize(settings: ExportSettings, durationSeconds: number, sampleRate = 48000): number {
  if (settings.container === 'png') return settings.width * settings.height * 2;
  if (settings.container === 'gif') {
    const h = (settings.gif.width * settings.height) / settings.width;
    // lzw on dithered photos lands near half a byte per pixel
    return settings.gif.width * h * settings.gif.fps * durationSeconds * 0.5;
  }
  let bits = 0;
  if (settings.includeVideo && settings.container !== 'wav') bits += videoBitrateFor(settings);
  if (settings.includeAudio) {
    bits +=
      settings.audioCodec === 'pcm-s16'
        ? sampleRate * 2 * 16
        : settings.audioCodec === 'flac'
          ? sampleRate * 2 * 9
          : settings.audioBitrate;
  }
  return (bits * durationSeconds) / 8;
}

export type FileContainer = Exclude<Container, 'gif' | 'png'>;

const containerFormats: Record<FileContainer, () => OutputFormat> = {
  mp4: () => new Mp4OutputFormat(),
  webm: () => new WebMOutputFormat(),
  mov: () => new MovOutputFormat(),
  mkv: () => new MkvOutputFormat(),
  wav: () => new WavOutputFormat()
};

export function formatFor(container: FileContainer, options?: { fastStart: false | 'in-memory' }): OutputFormat {
  if (container === 'mp4') return new Mp4OutputFormat(options);
  if (container === 'mov') return new MovOutputFormat(options);
  return containerFormats[container]();
}

export function mimeTypeFor(container: Container): string {
  if (container === 'gif') return 'image/gif';
  if (container === 'png') return 'image/png';
  return containerFormats[container]().mimeType;
}

export function fileNameFor(name: string, container: Container): string {
  const stem = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export';
  return `${stem}.${container}`;
}

const videoFallbacks: ExportVideoCodec[] = ['avc', 'vp9', 'av1', 'vp8'];
const audioFallbacks: ExportAudioCodec[] = ['aac', 'opus', 'pcm-s16', 'flac'];
// where to go when the codec the browser gives us doesn't fit the chosen file type
const containerFallbacks: FileContainer[] = ['mp4', 'webm', 'mkv'];

const codecNames: Record<ExportVideoCodec | ExportAudioCodec, string> = {
  avc: 'H.264',
  hevc: 'H.265',
  vp9: 'VP9',
  av1: 'AV1',
  vp8: 'VP8',
  aac: 'AAC',
  opus: 'Opus',
  'pcm-s16': 'PCM',
  flac: 'FLAC'
};
const containerNames: Record<Container, string> = {
  mp4: 'MP4',
  webm: 'WebM',
  mov: 'MOV',
  mkv: 'MKV',
  gif: 'GIF',
  wav: 'WAV',
  png: 'PNG'
};

export interface CodecProbe {
  video: (codec: VideoCodec, options: { width: number; height: number }) => Promise<boolean>;
  audio: (codec: AudioCodec, options: { numberOfChannels: number; sampleRate: number }) => Promise<boolean>;
}

const defaultProbe: CodecProbe = { video: canEncodeVideo, audio: canEncodeAudio };

function holds(container: Container, codec: ExportVideoCodec | ExportAudioCodec, kind: 'video' | 'audio'): boolean {
  if (container === 'gif' || container === 'png') return false;
  const format = containerFormats[container]();
  const list: string[] = kind === 'video' ? format.getSupportedVideoCodecs() : format.getSupportedAudioCodecs();
  return list.includes(codec);
}

// checks what this browser can actually encode and moves the settings to the
// closest thing that works, telling the user in plain words what changed
export async function resolveCodecs(
  input: ExportSettings,
  probe: CodecProbe = defaultProbe,
  sampleRate = 48000
): Promise<{ settings: ExportSettings; notes: string[] }> {
  const settings: ExportSettings = { ...input, gif: { ...input.gif } };
  const notes: string[] = [];
  if (settings.container === 'gif' || settings.container === 'png') return { settings, notes };

  if (settings.includeVideo && settings.container !== 'wav' && settings.videoCodec) {
    const wanted = settings.videoCodec;
    const candidates = [wanted, ...videoFallbacks.filter((c) => c !== wanted)];
    let chosen: ExportVideoCodec | null = null;
    for (const codec of candidates) {
      if (await probe.video(codec, { width: settings.width, height: settings.height })) {
        chosen = codec;
        break;
      }
    }
    if (!chosen) {
      throw new Error("This browser can't encode video. Chrome and Edge can, Firefox and Safari are still catching up.");
    }
    if (!holds(settings.container, chosen, 'video')) {
      const container = containerFallbacks.find((c) => holds(c, chosen, 'video'));
      if (!container) throw new Error(`${codecNames[chosen]} doesn't fit any file type this editor writes.`);
      if (chosen !== wanted) {
        notes.push(
          `${codecNames[wanted]} isn't available in this browser, using ${codecNames[chosen]} in ${containerNames[container]} instead.`
        );
      } else {
        notes.push(`${containerNames[settings.container]} can't hold ${codecNames[chosen]}, writing ${containerNames[container]} instead.`);
      }
      settings.container = container;
    } else if (chosen !== wanted) {
      notes.push(`${codecNames[wanted]} isn't available in this browser, using ${codecNames[chosen]} instead.`);
    }
    settings.videoCodec = chosen;
  }

  if (settings.includeAudio && settings.audioCodec) {
    const wanted = settings.audioCodec;
    const candidates = [wanted, ...audioFallbacks.filter((c) => c !== wanted)].filter((c) => holds(settings.container, c, 'audio'));
    let chosen: ExportAudioCodec | null = null;
    for (const codec of candidates) {
      if (await probe.audio(codec, { numberOfChannels: 2, sampleRate })) {
        chosen = codec;
        break;
      }
    }
    if (!chosen) {
      notes.push(`No audio codec for ${containerNames[settings.container]} works in this browser, exporting without audio.`);
      settings.includeAudio = false;
      settings.audioCodec = null;
    } else {
      if (chosen !== wanted) {
        const reason = holds(settings.container, wanted, 'audio')
          ? "isn't available in this browser"
          : `doesn't go into ${containerNames[settings.container]}`;
        notes.push(`${codecNames[wanted]} ${reason}, using ${codecNames[chosen]} instead.`);
      }
      settings.audioCodec = chosen;
    }
  }

  return { settings, notes };
}
