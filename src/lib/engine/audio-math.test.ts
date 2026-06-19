import { describe, it, expect } from 'vitest';
import type { Clip, Track } from '$lib/project/types';
import { automationTimes, catchUp, chunkPlacement, chunkSequenceEnd, dbToGain, gainToDb, sourceWindow, transitionGainAt } from './audio-math';

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'c1', kind: 'audio', name: 'c', mediaId: 'm', start: 10, duration: 4, in: 2,
    speed: 1, reverse: false, linkId: null, enabled: true, label: 'none', effects: [], keyframes: undefined, ...over
  } as Clip;
}

describe('dbToGain', () => {
  it('maps unity, silence and 6 db', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-60)).toBe(0);
    expect(dbToGain(-100)).toBe(0);
    expect(dbToGain(6)).toBeCloseTo(1.995, 2);
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0)).toBe(-60);
  });
});

describe('chunkPlacement', () => {
  it('places a chunk inside the clip', () => {
    const p = chunkPlacement(clip(), 3, 0.5)!;
    expect(p.seqStart).toBeCloseTo(11);
    expect(p.offset).toBe(0);
    expect(p.duration).toBe(0.5);
    expect(p.seqDuration).toBe(0.5);
  });

  it('trims the part before the in point', () => {
    const p = chunkPlacement(clip(), 1.8, 0.5)!;
    expect(p.seqStart).toBeCloseTo(10);
    expect(p.offset).toBeCloseTo(0.2);
    expect(p.duration).toBeCloseTo(0.3);
  });

  it('trims the part after the out point', () => {
    const p = chunkPlacement(clip(), 5.8, 0.5)!;
    expect(p.seqStart).toBeCloseTo(13.8);
    expect(p.offset).toBe(0);
    expect(p.duration).toBeCloseTo(0.2);
  });

  it('returns null outside the clip', () => {
    expect(chunkPlacement(clip(), 0, 1)).toBeNull();
    expect(chunkPlacement(clip(), 6, 1)).toBeNull();
    expect(chunkPlacement(clip(), 3, 0)).toBeNull();
  });

  it('shortens sequence time for fast clips', () => {
    const p = chunkPlacement(clip({ speed: 2, duration: 2 }), 3, 1)!;
    expect(p.seqStart).toBeCloseTo(10.5);
    expect(p.seqDuration).toBeCloseTo(0.5);
    expect(p.duration).toBe(1);
  });

  it('mirrors reversed clips', () => {
    // source 2..6 plays backwards over sequence 10..14: source 6 at 10, source 2 at 14
    const p = chunkPlacement(clip({ reverse: true }), 5, 1)!;
    expect(p.seqStart).toBeCloseTo(10);
    expect(p.offset).toBe(0);
    expect(p.duration).toBe(1);
    const q = chunkPlacement(clip({ reverse: true }), 1.5, 1)!;
    // the reversed buffer starts at source 2.5, source 2 is the clip's end
    expect(q.seqStart).toBeCloseTo(13.5);
    expect(q.offset).toBe(0);
    expect(q.duration).toBeCloseTo(0.5);
    const r = chunkPlacement(clip({ reverse: true }), 5.5, 1)!;
    expect(r.seqStart).toBeCloseTo(10);
    expect(r.offset).toBeCloseTo(0.5);
    expect(r.duration).toBeCloseTo(0.5);
  });
});

describe('chunkSequenceEnd', () => {
  it('reports how far a chunk reaches', () => {
    expect(chunkSequenceEnd(clip(), 3, 0.5)).toBeCloseTo(11.5);
    expect(chunkSequenceEnd(clip({ reverse: true }), 3, 0.5)).toBeCloseTo(13);
  });
});

describe('catchUp', () => {
  const p = { seqStart: 0, seqDuration: 1, offset: 0.25, duration: 1 };

  it('keeps future pieces as they are', () => {
    expect(catchUp(p, 5, 4, 1)).toEqual({ when: 5, offset: 0.25, duration: 1 });
  });

  it('skips the part that already passed', () => {
    const c = catchUp(p, 4, 4.4, 2)!;
    expect(c.when).toBe(4.4);
    expect(c.offset).toBeCloseTo(1.05);
    expect(c.duration).toBeCloseTo(0.2);
  });

  it('drops pieces entirely in the past', () => {
    expect(catchUp(p, 2, 4, 1)).toBeNull();
  });
});

describe('automationTimes', () => {
  it('samples along the piece without touching the end', () => {
    expect(automationTimes(1, 0.2, 0.05)).toEqual([1, 1.05, 1.1, 1.15]);
    expect(automationTimes(1, 0.2, 0)).toEqual([1]);
  });
});

describe('transitionGainAt', () => {
  const track = {
    transitions: [{ id: 't', type: 'crossfade', leftClipId: 'a', rightClipId: 'b', start: 5, duration: 2, params: {} }]
  } as unknown as Track;
  const curve = (_type: string, progress: number) => ({ outGain: 1 - progress, inGain: progress });

  it('fades the left clip out and the right one in', () => {
    expect(transitionGainAt(track, clip({ id: 'a' }), 5.5, curve)).toBeCloseTo(0.75);
    expect(transitionGainAt(track, clip({ id: 'b' }), 5.5, curve)).toBeCloseTo(0.25);
    expect(transitionGainAt(track, clip({ id: 'c' }), 5.5, curve)).toBe(1);
    expect(transitionGainAt(track, clip({ id: 'a' }), 8, curve)).toBe(1);
  });
});

describe('sourceWindow', () => {
  it('maps a sequence range into the source', () => {
    expect(sourceWindow(clip(), 11, 12, 100)).toEqual({ start: 3, end: 4 });
    expect(sourceWindow(clip(), 0, 11, 100)).toEqual({ start: 2, end: 3 });
    expect(sourceWindow(clip(), 20, 30, 100)).toEqual({ start: 0, end: 0 });
  });

  it('reads reversed clips from the end', () => {
    expect(sourceWindow(clip({ reverse: true }), 10, 11, 100)).toEqual({ start: 5, end: 6 });
  });

  it('clamps to the media', () => {
    expect(sourceWindow(clip(), 10, 14, 5)).toEqual({ start: 2, end: 5 });
  });
});
