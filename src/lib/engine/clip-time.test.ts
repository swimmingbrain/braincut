import { describe, it, expect } from 'vitest';
import type { Clip } from '$lib/project/types';
import { clipEnd, clipSourceRange, sequenceTimeOfSource, sourceTimeAt } from './clip-time';

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: 'c', kind: 'video', name: 'c', mediaId: 'm', start: 10, duration: 4, in: 2,
    speed: 1, reverse: false, linkId: null, enabled: true, label: 'none', effects: [], ...over
  };
}

describe('sourceTimeAt', () => {
  it('advances with the clip', () => {
    expect(sourceTimeAt(clip(), 10, 100)).toBe(2);
    expect(sourceTimeAt(clip(), 13, 100)).toBe(5);
  });

  it('scales with speed', () => {
    expect(sourceTimeAt(clip({ speed: 2 }), 11, 100)).toBe(4);
    expect(sourceTimeAt(clip({ speed: 0.5 }), 12, 100)).toBe(3);
  });

  it('runs backwards for reversed clips', () => {
    expect(sourceTimeAt(clip({ reverse: true }), 10, 100)).toBe(6);
    expect(sourceTimeAt(clip({ reverse: true }), 14, 100)).toBe(2);
  });

  it('freezes on the media ends', () => {
    expect(sourceTimeAt(clip(), 9, 100)).toBe(1);
    expect(sourceTimeAt(clip(), 0, 100)).toBe(0);
    expect(sourceTimeAt(clip(), 30, 5)).toBe(5);
  });

  it('has no upper bound without a media duration', () => {
    expect(sourceTimeAt(clip(), 30, 0)).toBe(22);
  });
});

describe('sequenceTimeOfSource', () => {
  it('inverts sourceTimeAt', () => {
    expect(sequenceTimeOfSource(clip(), 5)).toBe(13);
    expect(sequenceTimeOfSource(clip({ speed: 2 }), 4)).toBe(11);
    expect(sequenceTimeOfSource(clip({ reverse: true }), 6)).toBe(10);
    expect(sequenceTimeOfSource(clip({ reverse: true }), 2)).toBe(14);
  });
});

describe('ranges', () => {
  it('reports the source range and the end', () => {
    expect(clipSourceRange(clip({ speed: 2 }))).toEqual({ start: 2, end: 10 });
    expect(clipEnd(clip())).toBe(14);
  });
});
