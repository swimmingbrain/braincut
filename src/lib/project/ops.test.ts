import { describe, expect, it } from 'vitest';
import { createClipFromMedia, createColorClip, createMarker, createSequence, createTitleClip } from './defaults';
import * as ops from './ops';
import type { Clip, MediaItem, Sequence, Track } from './types';

const FPS = 50;
const F = 1 / FPS;

function media(over: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'm1', name: 'clip.mp4', kind: 'video', binId: null, duration: 10, width: 1920, height: 1080, fps: 25,
    hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000, videoCodec: 'avc', audioCodec: 'aac',
    container: 'mp4', mimeType: 'video/mp4', fileSize: 1, rotation: 0, alpha: false, status: 'ready',
    proxy: null, converted: null, thumbnail: null, label: 'none', addedAt: 0, ...over
  };
}

const lib = new Map<string, MediaItem>([['m1', media()]]);
const getMedia = (id: string) => lib.get(id);

function seq(): Sequence {
  return createSequence({ name: 't', width: 1920, height: 1080, fps: FPS });
}

// a title clip is the simplest thing that occupies time on a video track
function title(start: number, duration: number, name = 'c'): Clip {
  const c = createTitleClip(start, duration, name);
  c.name = name;
  return c;
}

function put(s: Sequence, trackIndex: number, clip: Clip): Clip {
  s.tracks[trackIndex].clips.push(clip);
  s.tracks[trackIndex].clips.sort((a, b) => a.start - b.start);
  return clip;
}

function layout(track: Track): [number, number][] {
  return track.clips.map((c) => [round(c.start), round(c.start + c.duration)]);
}

function names(track: Track): string[] {
  return track.clips.map((c) => c.name);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function av(s: Sequence, start: number, opts: { in?: number; duration?: number } = {}) {
  const { video, audio } = createClipFromMedia(media(), start, { ...opts, fps: FPS });
  put(s, 0, video!);
  put(s, 3, audio!);
  return { video: video!, audio: audio! };
}

describe('placing clips', () => {
  it('overwrite trims what is under the head and tail', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 0, title(4, 4, 'b'));
    ops.overwriteClip(s, s.tracks[0].id, title(0, 2, 'x'), 3);
    expect(names(s.tracks[0])).toEqual(['a', 'x', 'b']);
    expect(layout(s.tracks[0])).toEqual([[0, 3], [3, 5], [5, 8]]);
  });

  it('overwrite splits a clip it lands inside and keeps the source continuous', () => {
    const s = seq();
    const { video } = av(s, 0);
    ops.overwriteClip(s, s.tracks[0].id, title(0, 2, 'x'), 4);
    const t = s.tracks[0];
    expect(layout(t)).toEqual([[0, 4], [4, 6], [6, 10]]);
    expect(t.clips[0].id).toBe(video.id);
    expect(t.clips[2].in).toBe(6);
    expect(t.clips[2].id).not.toBe(video.id);
    expect(t.clips[2].linkId).toBe(video.linkId);
  });

  it('overwrite removes clips fully covered', () => {
    const s = seq();
    put(s, 0, title(1, 1, 'a'));
    put(s, 0, title(2, 1, 'b'));
    ops.overwriteClip(s, s.tracks[0].id, title(0, 5, 'x'), 0);
    expect(names(s.tracks[0])).toEqual(['x']);
  });

  it('insert ripples every unlocked track and cuts through spanning clips', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 0, title(4, 4, 'b'));
    put(s, 1, title(0, 8, 'long'));
    put(s, 2, title(6, 2, 'late'));
    s.tracks[3].locked = true;
    put(s, 3, { ...title(0, 8, 'locked'), kind: 'audio' });
    ops.insertClip(s, s.tracks[0].id, title(0, 2, 'x'), 2);
    expect(names(s.tracks[0])).toEqual(['a', 'x', 'a', 'b']);
    expect(layout(s.tracks[0])).toEqual([[0, 2], [2, 4], [4, 6], [6, 10]]);
    expect(layout(s.tracks[1])).toEqual([[0, 2], [4, 10]]);
    expect(layout(s.tracks[2])).toEqual([[8, 10]]);
    expect(layout(s.tracks[3])).toEqual([[0, 8]]);
  });

  it('insert at a cut just pushes', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 0, title(4, 4, 'b'));
    ops.insertClip(s, s.tracks[0].id, title(0, 1, 'x'), 4);
    expect(names(s.tracks[0])).toEqual(['a', 'x', 'b']);
    expect(layout(s.tracks[0])).toEqual([[0, 4], [4, 5], [5, 9]]);
  });

  it('refuses locked tracks and the wrong kind', () => {
    const s = seq();
    s.tracks[0].locked = true;
    expect(ops.insertClip(s, s.tracks[0].id, title(0, 1), 0)).toBe(false);
    expect(ops.overwriteClip(s, s.tracks[3].id, title(0, 1), 0)).toBe(false);
    expect(s.tracks[0].clips).toHaveLength(0);
  });

  it('snaps times to the frame grid', () => {
    const s = seq();
    ops.overwriteClip(s, s.tracks[0].id, title(0, 1.013, 'x'), 0.501);
    expect(s.tracks[0].clips[0].start).toBeCloseTo(0.5, 9);
    expect(s.tracks[0].clips[0].duration).toBeCloseTo(1.02, 9);
  });

  it('places a linked pair with one ripple', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 3, { ...title(0, 4, 'a-audio'), kind: 'audio' });
    const { video, audio } = createClipFromMedia(media(), 2, { duration: 2, fps: FPS });
    ops.placeClips(s, [{ trackId: s.tracks[0].id, clip: video! }, { trackId: s.tracks[3].id, clip: audio! }], 'insert');
    expect(layout(s.tracks[0])).toEqual([[0, 2], [2, 4], [4, 6]]);
    expect(layout(s.tracks[3])).toEqual([[0, 2], [2, 4], [4, 6]]);
  });

  it('canPlace checks the gap', () => {
    const s = seq();
    put(s, 0, title(2, 2, 'a'));
    const track = s.tracks[0].id;
    expect(ops.canPlace(s, track, 0, 2)).toBe(true);
    expect(ops.canPlace(s, track, 1, 2)).toBe(false);
    expect(ops.canPlace(s, track, 1, 2, [s.tracks[0].clips[0].id])).toBe(true);
    expect(ops.canPlace(s, track, 4, 2)).toBe(true);
  });
});

describe('moving clips', () => {
  it('moves a clip and its linked audio across tracks', () => {
    const s = seq();
    const { video, audio } = av(s, 0);
    ops.moveClips(s, [{ clipId: video.id, trackId: s.tracks[1].id, start: 5 }], 'overwrite');
    expect(s.tracks[0].clips).toHaveLength(0);
    expect(layout(s.tracks[1])).toEqual([[5, 15]]);
    expect(layout(s.tracks[3])).toEqual([[5, 15]]);
    expect(s.tracks[3].clips[0].id).toBe(audio.id);
  });

  it('overwrites what it lands on', () => {
    const s = seq();
    put(s, 0, title(0, 2, 'a'));
    put(s, 0, title(6, 4, 'b'));
    ops.moveClips(s, [{ clipId: s.tracks[0].clips[0].id, trackId: s.tracks[0].id, start: 5 }], 'overwrite');
    expect(names(s.tracks[0])).toEqual(['a', 'b']);
    expect(layout(s.tracks[0])).toEqual([[5, 7], [7, 10]]);
  });

  it('insert move pushes the rest', () => {
    const s = seq();
    put(s, 0, title(0, 2, 'a'));
    put(s, 0, title(6, 4, 'b'));
    ops.moveClips(s, [{ clipId: s.tracks[0].clips[0].id, trackId: s.tracks[0].id, start: 7 }], 'insert');
    expect(names(s.tracks[0])).toEqual(['b', 'a', 'b']);
    expect(layout(s.tracks[0])).toEqual([[6, 7], [7, 9], [9, 12]]);
  });

  it('refuses to move onto a locked track or before zero', () => {
    const s = seq();
    put(s, 0, title(1, 2, 'a'));
    s.tracks[1].locked = true;
    const clipId = s.tracks[0].clips[0].id;
    expect(ops.moveClips(s, [{ clipId, trackId: s.tracks[1].id, start: 0 }], 'overwrite')).toBe(false);
    expect(ops.moveClips(s, [{ clipId, trackId: s.tracks[0].id, start: -1 }], 'overwrite')).toBe(false);
    expect(layout(s.tracks[0])).toEqual([[1, 3]]);
  });
});

describe('trimming', () => {
  it('trims the head and moves in accordingly', () => {
    const s = seq();
    const { video } = av(s, 2, { in: 1, duration: 5 });
    ops.trimClipStart(s, video.id, 4, { getMedia });
    expect(video.start).toBe(4);
    expect(video.duration).toBe(3);
    expect(video.in).toBe(3);
  });

  it('clamps the head to the source and the previous clip', () => {
    const s = seq();
    put(s, 0, title(0, 1, 'before'));
    const { video } = av(s, 2, { in: 1, duration: 5 });
    ops.trimClipStart(s, video.id, -5, { getMedia });
    expect(video.start).toBe(1);
    expect(video.in).toBe(0);
    ops.trimClipStart(s, video.id, 0, { getMedia });
    expect(video.start).toBe(1);
  });

  it('never trims a clip shorter than a frame', () => {
    const s = seq();
    put(s, 0, title(0, 2, 'a'));
    const c = s.tracks[0].clips[0];
    ops.trimClipEnd(s, c.id, 0);
    expect(c.duration).toBeCloseTo(F, 9);
    ops.trimClipStart(s, c.id, 5);
    expect(c.duration).toBeCloseTo(F, 9);
  });

  it('clamps the tail to the media and the next clip', () => {
    const s = seq();
    const { video } = av(s, 0, { in: 2, duration: 4 });
    put(s, 0, title(7, 2, 'after'));
    ops.trimClipEnd(s, video.id, 20, { getMedia });
    expect(video.duration).toBe(7);
    ops.trimClipEnd(s, video.id, 20, {});
    expect(video.duration).toBe(7);
    s.tracks[0].clips.pop();
    ops.trimClipEnd(s, video.id, 20, { getMedia });
    expect(video.duration).toBe(8);
  });

  it('respects speed in the source bound', () => {
    const s = seq();
    const { video } = av(s, 0, { in: 0, duration: 5 });
    ops.setClipSpeed(s, video.id, 2, { getMedia });
    expect(video.duration).toBe(2.5);
    ops.trimClipEnd(s, video.id, 20, { getMedia });
    expect(video.duration).toBe(5);
  });

  it('ripple trims the tail and shifts every track', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 0, title(4, 4, 'b'));
    put(s, 1, title(4, 2, 'upper'));
    put(s, 3, { ...title(4, 2, 'aud'), kind: 'audio' });
    ops.trimClipEnd(s, s.tracks[0].clips[0].id, 2, { ripple: true });
    expect(layout(s.tracks[0])).toEqual([[0, 2], [2, 6]]);
    expect(layout(s.tracks[1])).toEqual([[2, 4]]);
    expect(layout(s.tracks[3])).toEqual([[2, 4]]);
  });

  it('ripple trims the head without moving the clip', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 0, title(4, 4, 'b'));
    ops.trimClipStart(s, s.tracks[0].clips[1].id, 6, { ripple: true });
    expect(layout(s.tracks[0])).toEqual([[0, 4], [4, 6]]);
  });

  it('ripple leaves other tracks alone when the range is occupied there', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 0, title(4, 4, 'b'));
    put(s, 1, title(0, 10, 'wall'));
    put(s, 1, title(10, 2, 'after'));
    ops.trimClipEnd(s, s.tracks[0].clips[0].id, 2, { ripple: true });
    expect(layout(s.tracks[0])).toEqual([[0, 2], [2, 6]]);
    expect(layout(s.tracks[1])).toEqual([[0, 10], [10, 12]]);
  });

  it('rolls a cut between two clips', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 0, title(4, 4, 'b'));
    const [a, b] = s.tracks[0].clips;
    expect(ops.rollEdit(s, a.id, b.id, 6)).toBe(6);
    expect(layout(s.tracks[0])).toEqual([[0, 6], [6, 8]]);
    expect(ops.rollEdit(s, a.id, b.id, 20)).toBeCloseTo(8 - F, 9);
  });

  it('slips within the source', () => {
    const s = seq();
    const { video } = av(s, 0, { in: 2, duration: 4 });
    expect(ops.slipClip(s, video.id, 3, { getMedia })).toBe(5);
    expect(ops.slipClip(s, video.id, 10, { getMedia })).toBe(6);
    expect(ops.slipClip(s, video.id, -10, { getMedia })).toBe(0);
    expect(video.start).toBe(0);
    expect(video.duration).toBe(4);
  });

  it('slides between neighbours', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    put(s, 0, title(4, 2, 'b'));
    put(s, 0, title(6, 4, 'c'));
    ops.slideClip(s, s.tracks[0].clips[1].id, 2);
    expect(layout(s.tracks[0])).toEqual([[0, 6], [6, 8], [8, 10]]);
    ops.slideClip(s, s.tracks[0].clips[1].id, -20);
    expect(layout(s.tracks[0])).toEqual([[0, F], [F, 2 + F].map(round) as [number, number], [round(2 + F), 10]]);
  });
});

describe('splitting and deleting', () => {
  it('splits at the playhead with correct in and duration', () => {
    const s = seq();
    const { video, audio } = av(s, 1, { in: 2, duration: 6 });
    const created = ops.splitClipsAt(s, 4);
    expect(created).toHaveLength(2);
    expect(layout(s.tracks[0])).toEqual([[1, 4], [4, 7]]);
    const right = s.tracks[0].clips[1];
    expect(right.in).toBe(5);
    expect(video.duration).toBe(3);
    expect(video.in).toBe(2);
    const rightAudio = s.tracks[3].clips[1];
    expect(right.linkId).toBe(rightAudio.linkId);
    expect(right.linkId).not.toBe(video.linkId);
    expect(audio.linkId).toBe(video.linkId);
  });

  it('splits a reversed clip from the right end of the source', () => {
    const s = seq();
    const { video } = av(s, 0, { in: 0, duration: 10 });
    video.reverse = true;
    ops.splitClipsAt(s, 4, [video.id]);
    expect(video.in).toBe(6);
    expect(s.tracks[0].clips[1].in).toBe(0);
  });

  it('shifts keyframes into the right half', () => {
    const s = seq();
    const c = put(s, 0, title(0, 4, 'a'));
    c.effects[1].keyframes.opacity = [
      { time: 1, value: 0, easing: 'linear' },
      { time: 3, value: 100, easing: 'linear' }
    ];
    ops.splitClipsAt(s, 2, [c.id]);
    expect(s.tracks[0].clips[1].effects[1].keyframes.opacity.map((k) => k.time)).toEqual([-1, 1]);
    expect(c.effects[1].keyframes.opacity.map((k) => k.time)).toEqual([1, 3]);
  });

  it('ignores edges and locked tracks', () => {
    const s = seq();
    put(s, 0, title(0, 4, 'a'));
    s.tracks[1].locked = true;
    put(s, 1, title(0, 4, 'b'));
    expect(ops.splitClipsAt(s, 0)).toEqual([]);
    expect(ops.splitClipsAt(s, 2)).toHaveLength(1);
    expect(s.tracks[1].clips).toHaveLength(1);
  });

  it('deletes and leaves a gap', () => {
    const s = seq();
    put(s, 0, title(0, 2, 'a'));
    put(s, 0, title(2, 2, 'b'));
    put(s, 0, title(4, 2, 'c'));
    ops.deleteClips(s, [s.tracks[0].clips[1].id]);
    expect(layout(s.tracks[0])).toEqual([[0, 2], [4, 6]]);
  });

  it('ripple delete closes the gap on the track and free tracks', () => {
    const s = seq();
    put(s, 0, title(0, 2, 'a'));
    put(s, 0, title(2, 2, 'b'));
    put(s, 0, title(4, 2, 'c'));
    put(s, 1, title(5, 1, 'free'));
    put(s, 2, title(3, 4, 'busy'));
    ops.rippleDelete(s, [s.tracks[0].clips[1].id]);
    expect(layout(s.tracks[0])).toEqual([[0, 2], [2, 4]]);
    expect(layout(s.tracks[1])).toEqual([[3, 4]]);
    expect(layout(s.tracks[2])).toEqual([[3, 7]]);
  });

  it('ripple deletes a linked pair once', () => {
    const s = seq();
    const { video, audio } = av(s, 0, { duration: 2 });
    put(s, 0, title(2, 2, 'after'));
    put(s, 1, title(4, 2, 'far'));
    ops.rippleDelete(s, [video.id, audio.id]);
    expect(layout(s.tracks[0])).toEqual([[0, 2]]);
    expect(layout(s.tracks[1])).toEqual([[2, 4]]);
    expect(s.tracks[3].clips).toHaveLength(0);
  });

  it('lifts and extracts a range', () => {
    const s = seq();
    put(s, 0, title(0, 10, 'a'));
    put(s, 1, title(0, 10, 'b'));
    ops.liftRange(s, 2, 4, [s.tracks[0].id]);
    expect(layout(s.tracks[0])).toEqual([[0, 2], [4, 10]]);
    expect(layout(s.tracks[1])).toEqual([[0, 10]]);
    ops.extractRange(s, 4, 6, [s.tracks[0].id]);
    expect(layout(s.tracks[0])).toEqual([[0, 2], [4, 8]]);
    expect(layout(s.tracks[1])).toEqual([[0, 10]]);
    ops.extractRange(s, 0, 1);
    expect(layout(s.tracks[0])).toEqual([[0, 1], [3, 7]]);
    expect(layout(s.tracks[1])).toEqual([[0, 9]]);
  });

  it('closes a gap under the playhead', () => {
    const s = seq();
    put(s, 0, title(0, 2, 'a'));
    put(s, 0, title(5, 2, 'b'));
    expect(ops.gapsOnTrack(s.tracks[0])).toEqual([{ start: 2, end: 5 }]);
    expect(ops.closeGap(s, s.tracks[0].id, 3)).toBe(true);
    expect(layout(s.tracks[0])).toEqual([[0, 2], [2, 4]]);
    expect(ops.closeGap(s, s.tracks[0].id, 1)).toBe(false);
  });
});

describe('links and speed', () => {
  it('links and unlinks', () => {
    const s = seq();
    const a = put(s, 0, title(0, 2, 'a'));
    const b = put(s, 3, { ...title(0, 2, 'b'), kind: 'audio' });
    const linkId = ops.linkClips(s, [a.id, b.id]);
    expect(linkId).toBeTruthy();
    expect(ops.linkedClips(s, a.id).map((c) => c.id)).toEqual([a.id, b.id]);
    ops.unlinkClips(s, [a.id]);
    expect(a.linkId).toBeNull();
    expect(b.linkId).toBeNull();
  });

  it('changes speed keeping the source range, clamped to the next clip', () => {
    const s = seq();
    const { video, audio } = av(s, 0, { duration: 4 });
    put(s, 0, title(6, 2, 'next'));
    ops.setClipSpeed(s, video.id, 0.5, { getMedia });
    expect(video.duration).toBe(6);
    expect(audio.duration).toBe(8);
    expect(video.speed).toBe(0.5);
    ops.setClipSpeed(s, video.id, 2, { reverse: true, getMedia });
    expect(video.duration).toBe(1.5);
    expect(video.reverse).toBe(true);
  });

  it('ripples the duration change when asked', () => {
    const s = seq();
    const { video } = av(s, 0, { duration: 4 });
    put(s, 0, title(4, 2, 'next'));
    put(s, 1, title(4, 2, 'other'));
    ops.setClipSpeed(s, video.id, 0.5, { rippleDurationChange: true, getMedia });
    expect(layout(s.tracks[0])).toEqual([[0, 8], [8, 10]]);
    expect(layout(s.tracks[1])).toEqual([[8, 10]]);
    expect(layout(s.tracks[3])).toEqual([[0, 8]]);
  });

  it('toggles enabled and label', () => {
    const s = seq();
    const a = put(s, 0, title(0, 2, 'a'));
    ops.setEnabled(s, [a.id], false);
    ops.setLabel(s, [a.id], 'rose');
    expect(a.enabled).toBe(false);
    expect(a.label).toBe('rose');
  });
});

describe('tracks', () => {
  it('adds, renumbers, reorders and removes', () => {
    const s = seq();
    const id = ops.addTrack(s, 'video');
    expect(s.tracks.map((t) => t.name)).toEqual(['V1', 'V2', 'V3', 'V4', 'A1', 'A2', 'A3']);
    ops.addTrack(s, 'audio', { index: 0 });
    expect(s.tracks.map((t) => t.name)).toEqual(['V1', 'V2', 'V3', 'V4', 'A1', 'A2', 'A3', 'A4']);
    ops.reorderTracks(s, id, 0);
    expect(s.tracks[0].id).toBe(id);
    expect(s.tracks[0].name).toBe('V1');
    expect(ops.removeTrack(s, id)).toBe(true);
    expect(s.tracks.filter((t) => t.kind === 'video')).toHaveLength(3);
    ops.renameTrack(s, s.tracks[0].id, 'Titles');
    ops.addTrack(s, 'video', { index: 0 });
    expect(s.tracks[1].name).toBe('Titles');
  });

  it('keeps the last track of a kind', () => {
    const s = createSequence({ name: 'x', width: 1, height: 1, fps: 25, videoTracks: 1, audioTracks: 1 });
    expect(ops.removeTrack(s, s.tracks[0].id)).toBe(false);
  });
});

describe('transitions', () => {
  function pair(s: Sequence) {
    const a = put(s, 0, title(0, 4, 'a'));
    const b = put(s, 0, title(4, 4, 'b'));
    return { a, b };
  }

  it('adds a centered transition on a cut', () => {
    const s = seq();
    const { a, b } = pair(s);
    const id = ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: a.id, rightClipId: b.id, duration: 1 });
    expect(id).toBeTruthy();
    const t = s.tracks[0].transitions[0];
    expect(t.start).toBe(3.5);
    expect(t.duration).toBe(1);
    expect(ops.transitionsForClip(s, a.id)).toHaveLength(1);
  });

  it('replaces the transition at the same cut and clamps to the shorter clip', () => {
    const s = seq();
    const { a, b } = pair(s);
    ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: a.id, rightClipId: b.id, duration: 1 });
    ops.addTransition(s, s.tracks[0].id, { type: 'wipeLeft', leftClipId: a.id, rightClipId: b.id, duration: 30, alignment: 'end' });
    expect(s.tracks[0].transitions).toHaveLength(1);
    const t = s.tracks[0].transitions[0];
    expect(t.type).toBe('wipeLeft');
    expect(t.start + t.duration).toBeLessThanOrEqual(8);
    expect(t.start).toBeGreaterThanOrEqual(0);
    expect(t.start).toBeLessThanOrEqual(4);
    expect(t.start + t.duration).toBeGreaterThanOrEqual(4);
  });

  it('single sided transitions sit at the clip edge', () => {
    const s = seq();
    const { a, b } = pair(s);
    ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: null, rightClipId: a.id, duration: 1 });
    ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: b.id, rightClipId: null, duration: 1 });
    const [head, tail] = s.tracks[0].transitions;
    expect(head.start).toBe(0);
    expect(tail.start).toBe(7);
    expect(tail.duration).toBe(1);
  });

  it('refuses a transition where there is no cut', () => {
    const s = seq();
    const a = put(s, 0, title(0, 4, 'a'));
    const b = put(s, 0, title(5, 4, 'b'));
    expect(ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: a.id, rightClipId: b.id, duration: 1 })).toBeNull();
  });

  it('drops the transition when the cut breaks and keeps it when it survives', () => {
    const s = seq();
    const { a, b } = pair(s);
    const id = ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: a.id, rightClipId: b.id, duration: 1 })!;
    ops.trimClipEnd(s, b.id, 6);
    expect(s.tracks[0].transitions.map((t) => t.id)).toEqual([id]);
    ops.moveClips(s, [{ clipId: b.id, trackId: s.tracks[0].id, start: 6 }], 'overwrite');
    expect(s.tracks[0].transitions).toHaveLength(0);
  });

  it('follows the right half after a split and travels with a ripple', () => {
    const s = seq();
    const { a, b } = pair(s);
    const id = ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: a.id, rightClipId: b.id, duration: 1 })!;
    ops.splitClipsAt(s, 2, [a.id]);
    expect(s.tracks[0].transitions[0].leftClipId).toBe(s.tracks[0].clips[1].id);
    ops.insertClip(s, s.tracks[1].id, title(0, 2, 'x'), 0);
    const t = s.tracks[0].transitions[0];
    expect(t.id).toBe(id);
    expect(t.start).toBe(5.5);
  });

  it('shrinks a transition that no longer fits', () => {
    const s = seq();
    const { a, b } = pair(s);
    ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: a.id, rightClipId: b.id, duration: 2 });
    ops.trimClipStart(s, a.id, 3.5);
    const t = s.tracks[0].transitions[0];
    expect(t.start).toBeGreaterThanOrEqual(3.5);
    expect(t.start + t.duration).toBeGreaterThan(4);
  });

  it('resizes and realigns', () => {
    const s = seq();
    const { a, b } = pair(s);
    const id = ops.addTransition(s, s.tracks[0].id, { type: 'fade', leftClipId: a.id, rightClipId: b.id, duration: 1 })!;
    ops.setTransitionAlignment(s, id, 'start');
    expect(s.tracks[0].transitions[0].start).toBe(4);
    ops.setTransitionAlignment(s, id, 'end');
    expect(s.tracks[0].transitions[0].start).toBe(3);
    ops.resizeTransition(s, id, 2, 2);
    expect(s.tracks[0].transitions[0]).toMatchObject({ start: 2, duration: 2 });
    ops.resizeTransition(s, id, 5, 2);
    expect(s.tracks[0].transitions[0].start).toBe(4);
    ops.removeTransition(s, id);
    expect(s.tracks[0].transitions).toHaveLength(0);
  });
});

describe('markers, in/out and navigation', () => {
  it('manages markers sorted by time', () => {
    const s = seq();
    ops.addMarker(s, createMarker(5));
    const id = ops.addMarker(s, createMarker(2.004, { name: 'two' }));
    expect(s.markers.map((m) => m.time)).toEqual([2, 5]);
    ops.updateMarker(s, id, { time: 7, note: 'n' });
    expect(s.markers.map((m) => m.time)).toEqual([5, 7]);
    ops.removeMarker(s, id);
    expect(s.markers).toHaveLength(1);
  });

  it('keeps in before out', () => {
    const s = seq();
    ops.setInOut(s, 5, 2);
    expect([s.inPoint, s.outPoint]).toEqual([2, 5]);
    ops.clearInOut(s);
    expect([s.inPoint, s.outPoint]).toEqual([null, null]);
  });

  it('walks edit points on unlocked tracks', () => {
    const s = seq();
    put(s, 0, title(0, 2, 'a'));
    put(s, 1, title(3, 1, 'b'));
    s.tracks[2].locked = true;
    put(s, 2, title(2.5, 1, 'locked'));
    expect(ops.nextEdit(s, 0)).toBe(2);
    expect(ops.nextEdit(s, 2)).toBe(3);
    expect(ops.nextEdit(s, 4)).toBeNull();
    expect(ops.prevEdit(s, 3.5)).toBe(3);
    expect(ops.prevEdit(s, 0)).toBeNull();
  });

  it('finds clips at a time', () => {
    const s = seq();
    const a = put(s, 0, title(0, 2, 'a'));
    put(s, 1, createColorClip(1, 2, '#000000'));
    expect(ops.clipAt(s.tracks[0], 1.5)?.id).toBe(a.id);
    expect(ops.clipAt(s.tracks[0], 2)).toBeNull();
    expect(ops.clipsAt(s, 1.5)).toHaveLength(2);
    expect(ops.findClipById(s, a.id)?.track.id).toBe(s.tracks[0].id);
    expect(ops.trackOf(s, 'nope')).toBeNull();
  });

  it('describes media bounds', () => {
    const s = seq();
    const { video } = av(s, 0, { in: 2, duration: 4 });
    expect(ops.mediaBound(video, media())).toEqual({ maxIn: 6, maxDuration: 8 });
    expect(ops.mediaBound(title(0, 1), undefined)).toBeNull();
  });
});
