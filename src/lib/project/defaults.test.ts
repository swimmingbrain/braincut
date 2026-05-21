import { describe, expect, it } from 'vitest';
import { createClipFromMedia, createSequence, createTitleClip, fixedEffects, sequenceDuration } from './defaults';
import type { MediaItem } from './types';

function media(over: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'm1', name: 'clip.mp4', kind: 'video', binId: null, duration: 10, width: 1920, height: 1080, fps: 25,
    hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000, videoCodec: 'avc', audioCodec: 'aac',
    container: 'mp4', mimeType: 'video/mp4', fileSize: 1, rotation: 0, alpha: false, status: 'ready',
    proxy: null, converted: null, thumbnail: null, label: 'none', addedAt: 0, ...over
  };
}

describe('defaults', () => {
  it('creates a sequence with three video and three audio tracks', () => {
    const seq = createSequence({ name: 'Main', width: 1920, height: 1080, fps: 25 });
    expect(seq.tracks.map((t) => t.name)).toEqual(['V1', 'V2', 'V3', 'A1', 'A2', 'A3']);
    expect(seq.tracks[0].height).toBe(56);
    expect(seq.tracks[3].height).toBe(40);
    expect(seq.sampleRate).toBe(48000);
  });

  it('gives every clip kind its fixed effects', () => {
    expect(fixedEffects('video').map((e) => e.type)).toEqual(['transform', 'opacity']);
    expect(fixedEffects('audio').map((e) => e.type)).toEqual(['volume', 'pan']);
    expect(fixedEffects('title')[0].params.scale).toBe(100);
    expect(fixedEffects('video')[1].params.blendMode).toBe('normal');
  });

  it('links audio and video from one file', () => {
    const { video, audio } = createClipFromMedia(media(), 2, { fps: 25 });
    expect(video?.kind).toBe('video');
    expect(audio?.kind).toBe('audio');
    expect(video?.linkId).toBeTruthy();
    expect(video?.linkId).toBe(audio?.linkId);
    expect(video?.duration).toBe(10);
    expect(video?.start).toBe(2);
  });

  it('clamps in and duration to the media', () => {
    const { video } = createClipFromMedia(media({ hasAudio: false }), 0, { in: 8, duration: 5, fps: 25 });
    expect(video?.in).toBe(8);
    expect(video?.duration).toBe(2);
  });

  it('uses the still duration for images', () => {
    const { video, audio } = createClipFromMedia(media({ kind: 'image', duration: 0, hasAudio: false }), 0, { stillDuration: 4, fps: 25 });
    expect(video?.kind).toBe('image');
    expect(video?.duration).toBe(4);
    expect(audio).toBeUndefined();
  });

  it('handles audio only files', () => {
    const { video, audio } = createClipFromMedia(media({ kind: 'audio', hasVideo: false }), 0);
    expect(video).toBeUndefined();
    expect(audio?.effects.map((e) => e.type)).toEqual(['volume', 'pan']);
  });

  it('measures the sequence', () => {
    const seq = createSequence({ name: 'x', width: 1, height: 1, fps: 25 });
    seq.tracks[1].clips.push(createTitleClip(3, 4));
    expect(sequenceDuration(seq)).toBe(7);
  });
});
