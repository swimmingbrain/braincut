import { describe, it, expect } from 'vitest';
import { createSequence } from '$lib/project/defaults';
import type { Sequence } from '$lib/project/types';
import { MAX_SHUTTLE, nextShuttleRate, playRange } from './player';

function sequence(over: Partial<Sequence> = {}): Sequence {
  const seq = createSequence({ name: 's', width: 1920, height: 1080, fps: 25, videoTracks: 1, audioTracks: 0 });
  seq.tracks[0].clips.push({
    id: 'c', kind: 'color', name: 'c', mediaId: null, start: 2, duration: 8, in: 0,
    speed: 1, reverse: false, linkId: null, enabled: true, label: 'none', effects: [], color: '#000000'
  });
  return { ...seq, ...over };
}

describe('nextShuttleRate', () => {
  it('starts at the rate asked for', () => {
    expect(nextShuttleRate(0, 1)).toBe(1);
    expect(nextShuttleRate(0, -1)).toBe(-1);
    expect(nextShuttleRate(0, 0.5)).toBe(0.5);
  });

  it('doubles in the same direction up to the cap', () => {
    expect(nextShuttleRate(1, 1)).toBe(2);
    expect(nextShuttleRate(2, 1)).toBe(4);
    expect(nextShuttleRate(4, 1)).toBe(8);
    expect(nextShuttleRate(8, 1)).toBe(MAX_SHUTTLE);
    expect(nextShuttleRate(-2, -1)).toBe(-4);
  });

  it('turns around at 1x and stops on zero', () => {
    expect(nextShuttleRate(4, -1)).toBe(-1);
    expect(nextShuttleRate(-4, 1)).toBe(1);
    expect(nextShuttleRate(4, 0)).toBe(0);
  });

  it('takes an explicit rate as is', () => {
    expect(nextShuttleRate(1, 2)).toBe(2);
    expect(nextShuttleRate(2, 0.25)).toBe(0.25);
  });
});

describe('playRange', () => {
  it('covers the whole sequence', () => {
    expect(playRange(sequence(), false)).toEqual({ start: 0, end: 10 });
    expect(playRange(sequence(), true)).toEqual({ start: 0, end: 10 });
  });

  it('loops over the in/out range only when looping', () => {
    const seq = sequence({ inPoint: 3, outPoint: 6 });
    expect(playRange(seq, false)).toEqual({ start: 0, end: 10 });
    expect(playRange(seq, true)).toEqual({ start: 3, end: 6 });
  });

  it('ignores an empty or backwards range', () => {
    expect(playRange(sequence({ inPoint: 6, outPoint: 6 }), true)).toEqual({ start: 0, end: 10 });
    expect(playRange(sequence({ inPoint: 6, outPoint: 3 }), true)).toEqual({ start: 0, end: 10 });
    expect(playRange(sequence({ inPoint: 3, outPoint: null }), true)).toEqual({ start: 0, end: 10 });
  });

  it('never runs past the sequence end', () => {
    expect(playRange(sequence({ inPoint: 8, outPoint: 30 }), true)).toEqual({ start: 8, end: 10 });
  });
});
