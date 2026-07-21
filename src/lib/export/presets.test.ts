import { describe, expect, it } from 'vitest';
import type { Sequence } from '$lib/project/types';
import { estimateSize, fileNameFor, findPreset, presets, resolveCodecs, roundEven, settingsFromPreset, type CodecProbe } from './presets';

const sequence = (width: number, height: number, fps = 25): Sequence => ({
  id: 's',
  name: 'Sequence',
  width,
  height,
  fps,
  sampleRate: 48000,
  tracks: [],
  markers: [],
  inPoint: null,
  outPoint: null
});

const preset = (id: string) => {
  const p = findPreset(id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
};

const probe = (video: string[], audio: string[]): CodecProbe => ({
  video: async (codec) => video.includes(codec),
  audio: async (codec) => audio.includes(codec)
});

describe('roundEven', () => {
  it('rounds to the nearest even number and never below 2', () => {
    expect(roundEven(1079)).toBe(1080);
    expect(roundEven(1080.9)).toBe(1080);
    expect(roundEven(1081)).toBe(1082);
    expect(roundEven(0)).toBe(2);
  });
});

describe('settingsFromPreset', () => {
  it('matches the sequence', () => {
    const s = settingsFromPreset(preset('match'), sequence(1234, 701, 29.97));
    expect(s.width).toBe(1234);
    expect(s.height).toBe(702);
    expect(s.fps).toBe(29.97);
  });

  it('keeps the sequence aspect inside a fixed size', () => {
    const s = settingsFromPreset(preset('youtube-1080'), sequence(1440, 1080));
    expect(s.width).toBe(1440);
    expect(s.height).toBe(1080);
  });

  it('turns the box around for portrait sequences', () => {
    const s = settingsFromPreset(preset('youtube-1080'), sequence(1080, 1920));
    expect(s.width).toBe(1080);
    expect(s.height).toBe(1920);
  });

  it('does not share the gif object between calls', () => {
    const a = settingsFromPreset(preset('gif'), sequence(1920, 1080));
    const b = settingsFromPreset(preset('gif'), sequence(1920, 1080));
    a.gif.fps = 5;
    expect(b.gif.fps).toBe(15);
  });

  it('has unique preset ids', () => {
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
  });
});

describe('estimateSize', () => {
  it('grows with duration and quality', () => {
    const s = settingsFromPreset(preset('youtube-1080'), sequence(1920, 1080, 30));
    const ten = estimateSize(s, 10);
    const twenty = estimateSize(s, 20);
    expect(twenty).toBeCloseTo(ten * 2, -3);
    expect(estimateSize({ ...s, quality: 'low' }, 10)).toBeLessThan(ten);
  });

  it('uses the custom bitrate', () => {
    const s = {
      ...settingsFromPreset(preset('match'), sequence(1920, 1080)),
      quality: 'custom' as const,
      videoBitrate: 8_000_000,
      includeAudio: false
    };
    expect(estimateSize(s, 10)).toBe(10_000_000);
  });

  it('sizes wav from the sample rate', () => {
    const s = settingsFromPreset(preset('wav'), sequence(1920, 1080));
    expect(estimateSize(s, 1, 48000)).toBe(192_000);
  });
});

describe('fileNameFor', () => {
  it('strips characters a file system rejects', () => {
    expect(fileNameFor('cut: final/v2', 'mp4')).toBe('cut- final-v2.mp4');
    expect(fileNameFor('   ', 'wav')).toBe('export.wav');
  });
});

describe('resolveCodecs', () => {
  it('keeps settings that work', async () => {
    const s = settingsFromPreset(preset('match'), sequence(1920, 1080));
    const { settings, notes } = await resolveCodecs(s, probe(['avc'], ['aac']));
    expect(settings.videoCodec).toBe('avc');
    expect(settings.audioCodec).toBe('aac');
    expect(settings.container).toBe('mp4');
    expect(notes).toEqual([]);
  });

  it('falls back to vp9 in mp4 when h.264 is missing', async () => {
    const s = settingsFromPreset(preset('match'), sequence(1920, 1080));
    const { settings, notes } = await resolveCodecs(s, probe(['vp9'], ['aac']));
    expect(settings.videoCodec).toBe('vp9');
    expect(settings.container).toBe('mp4');
    expect(notes[0]).toMatch(/H\.264 isn't available/);
  });

  it('switches to mp4 when webm cannot hold the codec that works', async () => {
    const s = settingsFromPreset(preset('webm-vp9'), sequence(1920, 1080));
    const { settings, notes } = await resolveCodecs(s, probe(['avc'], ['aac']));
    expect(settings.videoCodec).toBe('avc');
    expect(settings.container).toBe('mp4');
    expect(settings.audioCodec).toBe('aac');
    expect(notes.join(' ')).toMatch(/VP9 isn't available in this browser, using H\.264 in MP4 instead/);
    expect(notes.join(' ')).toMatch(/Opus isn't available in this browser, using AAC instead/);
  });

  it('moves audio to a codec the container holds', async () => {
    const s = { ...settingsFromPreset(preset('webm-vp9'), sequence(1920, 1080)), audioCodec: 'aac' as const };
    const { settings, notes } = await resolveCodecs(s, probe(['vp9'], ['aac', 'opus']));
    expect(settings.container).toBe('webm');
    expect(settings.audioCodec).toBe('opus');
    expect(notes.join(' ')).toMatch(/AAC doesn't go into WebM, using Opus instead/);
  });

  it('moves h.264 out of webm', async () => {
    const s = { ...settingsFromPreset(preset('webm-vp9'), sequence(1920, 1080)), videoCodec: 'avc' as const };
    const { settings, notes } = await resolveCodecs(s, probe(['avc'], ['opus']));
    expect(settings.container).toBe('mp4');
    expect(notes[0]).toMatch(/WebM can't hold H\.264/);
  });

  it('drops audio when nothing encodes it', async () => {
    const s = settingsFromPreset(preset('match'), sequence(1920, 1080));
    const { settings, notes } = await resolveCodecs(s, probe(['avc'], []));
    expect(settings.includeAudio).toBe(false);
    expect(settings.audioCodec).toBeNull();
    expect(notes.join(' ')).toMatch(/without audio/);
  });

  it('throws in plain words when nothing encodes video', async () => {
    const s = settingsFromPreset(preset('match'), sequence(1920, 1080));
    await expect(resolveCodecs(s, probe([], ['aac']))).rejects.toThrow(/can't encode video/);
  });

  it('leaves wav and gif alone', async () => {
    const wav = settingsFromPreset(preset('wav'), sequence(1920, 1080));
    const { settings } = await resolveCodecs(wav, probe([], ['pcm-s16']));
    expect(settings.audioCodec).toBe('pcm-s16');
    const gif = settingsFromPreset(preset('gif'), sequence(1920, 1080));
    expect((await resolveCodecs(gif, probe([], []))).settings.container).toBe('gif');
  });

  it('does not mutate the input', async () => {
    const s = settingsFromPreset(preset('match'), sequence(1920, 1080));
    await resolveCodecs(s, probe(['vp9'], ['opus']));
    expect(s.videoCodec).toBe('avc');
    expect(s.audioCodec).toBe('aac');
  });
});
