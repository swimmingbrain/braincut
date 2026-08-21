import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  bandValueToY,
  clampZoom,
  cutNear,
  edgeZone,
  editPointsOfClip,
  fitZoom,
  kindIndex,
  linkedEdges,
  nearestEditPoint,
  peakOfRange,
  rowAtY,
  rulerScale,
  rulerTicks,
  siblingTrack,
  timeToX,
  WAVE_FLOOR,
  WAVE_HEADROOM,
  waveformGain,
  trackOffsetRange,
  trackRows,
  xToTime,
  yToBandValue,
  zoomAround,
  zoomToFit
} from './timeline-interactions';
import { createClipFromMedia, createSequence, createTitleClip } from '$lib/project/defaults';
import { loadProject, project } from '$lib/project/store';
import { timelineScroll, timelineZoom } from '$lib/stores/app';
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
  const s = createSequence({ name: 's', width: 1, height: 1, fps: 25 });
  s.tracks[0].clips.push(createTitleClip(0, 2, 'a'), createTitleClip(2, 3, 'b'), createTitleClip(8, 1, 'c'));
  return s;
}

describe('pixel and time', () => {
  it('converts both ways', () => {
    expect(timeToX(3, 100, 1)).toBe(200);
    expect(xToTime(200, 100, 1)).toBe(3);
    expect(xToTime(-500, 100, 1)).toBe(0);
  });

  it('clamps the zoom', () => {
    expect(clampZoom(1)).toBe(5);
    expect(clampZoom(1e6)).toBe(2000);
  });

  it('keeps the time under the pointer while zooming', () => {
    const before = { zoom: 100, scroll: 2 };
    const after = zoomAround(before.zoom, before.scroll, 200, 300);
    expect(before.scroll + 300 / before.zoom).toBeCloseTo(after.scroll + 300 / after.zoom);
  });

  it('never scrolls before the sequence start', () => {
    expect(zoomAround(100, 0, 50, 300).scroll).toBe(0);
  });
});

describe('ruler', () => {
  it('picks a step that leaves room for labels', () => {
    expect(rulerScale(100, 25)).toEqual({ major: 1, minor: 0.2 });
    expect(rulerScale(1000, 25).major).toBeCloseTo(2 / 25);
    expect(rulerScale(5, 25)).toEqual({ major: 30, minor: 2 });
  });

  it('lists ticks across the visible range', () => {
    const ticks = rulerTicks(1, 100, 400, 25);
    expect(ticks[0].time).toBeCloseTo(1);
    expect(ticks[ticks.length - 1].time).toBeCloseTo(5);
    expect(ticks.filter((t) => t.major).map((t) => t.time)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('rows', () => {
  it('stacks video top down and audio below', () => {
    const rows = trackRows(seq());
    expect(rows.map((r) => r.track.name)).toEqual(['V3', 'V2', 'V1', 'A1', 'A2', 'A3']);
    expect(rows[3].top).toBe(56 * 3);
    expect(rowAtY(rows, 56 * 3 + 5)?.track.name).toBe('A1');
    expect(rowAtY(rows, 10000)).toBeNull();
  });

  it('finds sibling tracks of the same kind, clamped', () => {
    const s = seq();
    const v1 = s.tracks[0];
    expect(kindIndex(s, v1.id)).toBe(0);
    expect(siblingTrack(s, v1.id, 1)?.name).toBe('V2');
    expect(siblingTrack(s, v1.id, 5)?.name).toBe('V3');
    expect(siblingTrack(s, v1.id, -3)?.name).toBe('V1');
  });

  it('stops a group of clips before one of them falls off the edge', () => {
    const s = seq();
    const [v1, v2, v3] = s.tracks.filter((t) => t.kind === 'video');
    expect(trackOffsetRange(s, [v1.id])).toEqual({ min: 0, max: 2 });
    expect(trackOffsetRange(s, [v3.id])).toEqual({ min: -2, max: 0 });
    // a clip on the bottom track and one above it can only go up
    expect(trackOffsetRange(s, [v1.id, v2.id])).toEqual({ min: 0, max: 1 });
    // video and audio halves of a linked pair are counted per kind
    const a1 = s.tracks.filter((t) => t.kind === 'audio')[0];
    expect(trackOffsetRange(s, [v1.id, a1.id])).toEqual({ min: 0, max: 2 });
    expect(trackOffsetRange(s, [])).toEqual({ min: 0, max: 0 });
  });
});

describe('hit zones', () => {
  it('splits a clip into head, body and tail', () => {
    expect(edgeZone(2, 100)).toBe('head');
    expect(edgeZone(50, 100)).toBe('body');
    expect(edgeZone(97, 100)).toBe('tail');
    // a narrow clip keeps a body in the middle
    expect(edgeZone(4, 9)).toBe('body');
  });

  it('finds the cut near a time with the clips on both sides', () => {
    const track = seq().tracks[0];
    const [a, b, c] = track.clips;
    expect(cutNear(track, 2.1, 0.2)).toEqual({ cut: 2, leftClipId: a.id, rightClipId: b.id });
    expect(cutNear(track, 5.1, 0.2)).toEqual({ cut: 5, leftClipId: b.id, rightClipId: null });
    expect(cutNear(track, 7.9, 0.2)).toEqual({ cut: 8, leftClipId: null, rightClipId: c.id });
    expect(cutNear(track, 6.5, 0.2)).toBeNull();
  });

  it('collects the linked edges that sit on the same time', () => {
    const s = seq();
    const { video, audio } = createClipFromMedia(media(), 1, { duration: 3, fps: 25 });
    s.tracks[1].clips.push(video!);
    s.tracks[3].clips.push(audio!);
    expect(linkedEdges(s, video!.id, 'head').map((e) => e.clipId).sort()).toEqual([video!.id, audio!.id].sort());
    audio!.start = 1.5;
    audio!.duration = 2.5;
    expect(linkedEdges(s, video!.id, 'head').map((e) => e.clipId)).toEqual([video!.id]);
    expect(linkedEdges(s, video!.id, 'tail')).toHaveLength(2);
  });
});

describe('rubber band', () => {
  it('maps values onto the clip height and back', () => {
    expect(bandValueToY('opacity', 100, 40)).toBe(0);
    expect(bandValueToY('opacity', 0, 40)).toBe(40);
    expect(yToBandValue('opacity', 20, 40)).toBe(50);
    expect(yToBandValue('volume', 40, 40)).toBe(-60);
    expect(bandValueToY('volume', 0, 72)).toBeCloseTo(12);
  });
});

describe('zoom to fit', () => {
  it('fits the sequence into the viewport', () => {
    const s = seq();
    loadProject({ id: 'p', name: 'p', version: 1, createdAt: 0, modifiedAt: 0, media: [], bins: [], sequences: [s], activeSequenceId: s.id });
    timelineScroll.set(4);
    zoomToFit(1000);
    expect(get(timelineScroll)).toBe(0);
    // nine seconds of clips plus a little air fit into 992 px
    expect(get(timelineZoom)).toBeCloseTo(992 / (9 * 1.04));
    project.set(null);
  });

  it('is the zoom the status bar shows a percentage of', () => {
    expect(fitZoom(9, 1000)).toBeCloseTo(992 / (9 * 1.04));
    // an empty sequence shows ten seconds
    expect(fitZoom(0, 1000)).toBeCloseTo(99.2);
    // and it stays inside the zoom range whatever it is asked for
    expect(fitZoom(0.0001, 1000)).toBe(2000);
    expect(fitZoom(100000, 1000)).toBe(5);
  });
});

describe('edit points', () => {
  it('gives both edges of a clip, joined to the neighbour when there is one', () => {
    const s = seq();
    const [a, b, c] = s.tracks[0].clips;
    expect(editPointsOfClip(s, b.id).map((p) => p.cut)).toEqual([
      { cut: 2, leftClipId: a.id, rightClipId: b.id },
      { cut: 5, leftClipId: b.id, rightClipId: null }
    ]);
    // nothing touches c on its head, so that edge comes out of black
    expect(editPointsOfClip(s, c.id)[0].cut).toEqual({ cut: 8, leftClipId: null, rightClipId: c.id });
    s.tracks[0].locked = true;
    expect(editPointsOfClip(s, b.id)).toEqual([]);
  });

  it('picks the one nearest the playhead so a keypress adds a single transition', () => {
    const s = seq();
    const b = s.tracks[0].clips[1];
    const points = editPointsOfClip(s, b.id);
    expect(nearestEditPoint(points, 2.4)?.cut.cut).toBe(2);
    expect(nearestEditPoint(points, 4.9)?.cut.cut).toBe(5);
    expect(nearestEditPoint([], 0)).toBeNull();
  });
});

// min/max pairs at 50 buckets a second, all of them at ±level
function peaks(level: number, seconds: number): Float32Array {
  const out = new Float32Array(seconds * 50 * 2);
  for (let i = 0; i < out.length; i += 2) {
    out[i] = -level;
    out[i + 1] = level;
  }
  return out;
}

describe('waveform gain', () => {
  it('finds the loudest sample of a source range', () => {
    const p = peaks(0.2, 4);
    p[2 * 120] = -0.8;
    expect(peakOfRange(p, 0, 4, 50)).toBeCloseTo(0.8, 5);
    // the spike sits at 2.4 s, so a range that ends before it does not see it
    expect(peakOfRange(p, 0, 2, 50)).toBeCloseTo(0.2, 5);
    expect(peakOfRange(p, 2.3, 2.5, 50)).toBeCloseTo(0.8, 5);
    // a range past the end of the peaks is clamped, not read out of bounds
    expect(peakOfRange(p, 3.5, 60, 50)).toBeCloseTo(0.2, 5);
  });

  it('lifts quiet material into the lane without letting a loud one clip', () => {
    // -18 dBFS, the level real material comes in at
    const quiet = 10 ** (-18 / 20);
    expect(quiet * waveformGain(quiet)).toBeCloseTo(WAVE_HEADROOM, 5);
    // full scale keeps the same headroom, so nothing is ever drawn past the edge
    expect(1 * waveformGain(1)).toBeCloseTo(WAVE_HEADROOM, 5);
    for (const peak of [0.001, 0.02, quiet, 0.5, 1]) {
      expect(peak * waveformGain(peak)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps silence flat and a nearly silent clip quiet', () => {
    expect(waveformGain(0)).toBe(0);
    // below the floor the gain stops growing, so a whisper still looks like one
    const whisper = 0.004;
    expect(whisper * waveformGain(whisper)).toBeCloseTo((whisper / WAVE_FLOOR) * WAVE_HEADROOM, 5);
    expect(whisper * waveformGain(whisper)).toBeLessThan(0.1);
  });

  it('fills the lane at every track height', () => {
    // what the canvas draws: half the body each way from the middle
    const drawn = (peak: number, height: number) => Math.round(Math.min(1, peak * waveformGain(peak)) * (height / 2)) * 2;
    for (const height of [9, 23, 40, 79, 150]) {
      expect(drawn(10 ** (-18 / 20), height), `height ${height}`).toBeGreaterThanOrEqual(Math.floor(height * 0.9));
    }
  });
});
