import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { clearClipboard, copyClips, cutClips, hasClipboard, pasteClips } from './clipboard';
import { createClipFromMedia, createSequence, createTitleClip } from '$lib/project/defaults';
import type { MediaItem } from '$lib/project/types';

function media(): MediaItem {
  return {
    id: 'm1', name: 'clip.mp4', kind: 'video', binId: null, duration: 10, width: 1920, height: 1080, fps: 25,
    hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000, videoCodec: 'avc', audioCodec: 'aac',
    container: 'mp4', mimeType: 'video/mp4', fileSize: 1, rotation: 0, alpha: false, status: 'ready',
    proxy: null, converted: null, thumbnail: null, label: 'none', addedAt: 0
  };
}

function seq() {
  const s = createSequence({ name: 's', width: 1, height: 1, fps: 50 });
  const { video, audio } = createClipFromMedia(media(), 2, { duration: 3, fps: 50 });
  s.tracks[1].clips.push(video!);
  s.tracks[3].clips.push(audio!);
  s.tracks[2].clips.push(createTitleClip(4, 1, 't'));
  return s;
}

describe('clipboard', () => {
  beforeEach(() => clearClipboard());

  it('copies and pastes on the same track indices with fresh ids', () => {
    const s = seq();
    const ids = [s.tracks[1].clips[0].id, s.tracks[3].clips[0].id, s.tracks[2].clips[0].id];
    expect(copyClips(s, ids)).toBe(3);
    expect(get(hasClipboard)).toBe(true);
    const placed = pasteClips(s, 10);
    expect(placed).toHaveLength(3);
    expect(s.tracks[1].clips.map((c) => c.start)).toEqual([2, 10]);
    expect(s.tracks[2].clips.map((c) => c.start)).toEqual([4, 12]);
    expect(s.tracks[3].clips.map((c) => c.start)).toEqual([2, 10]);
    const [orig, copy] = s.tracks[1].clips;
    expect(copy.id).not.toBe(orig.id);
    expect(copy.linkId).not.toBe(orig.linkId);
    expect(copy.linkId).toBe(s.tracks[3].clips[1].linkId);
    expect(copy.effects[0].id).not.toBe(orig.effects[0].id);
  });

  it('shifts to the hinted track and clamps to existing tracks', () => {
    const s = seq();
    copyClips(s, [s.tracks[1].clips[0].id, s.tracks[2].clips[0].id]);
    pasteClips(s, 0, { trackHint: s.tracks[2].id });
    expect(s.tracks[2].clips.map((c) => c.start)).toEqual([0, 2, 4]);
    expect(s.tracks[2].clips[0].kind).toBe('video');
    // the title from V3 would land on V4, which does not exist, so it stays on V3
    expect(s.tracks[2].clips.length + s.tracks[1].clips.length).toBe(4);
  });

  it('pastes in overwrite mode', () => {
    const s = seq();
    copyClips(s, [s.tracks[2].clips[0].id]);
    pasteClips(s, 4.5);
    expect(s.tracks[2].clips.map((c) => [c.start, c.duration])).toEqual([[4, 0.5], [4.5, 1]]);
  });

  it('cuts', () => {
    const s = seq();
    expect(cutClips(s, [s.tracks[2].clips[0].id])).toBe(1);
    expect(s.tracks[2].clips).toHaveLength(0);
    expect(pasteClips(s, 0)).toHaveLength(1);
    expect(s.tracks[2].clips[0].start).toBe(0);
  });

  it('is empty after clearing', () => {
    const s = seq();
    copyClips(s, [s.tracks[2].clips[0].id]);
    clearClipboard();
    expect(get(hasClipboard)).toBe(false);
    expect(pasteClips(s, 0)).toEqual([]);
    expect(copyClips(s, ['nope'])).toBe(0);
  });
});
