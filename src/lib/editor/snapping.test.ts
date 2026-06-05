import { describe, expect, it } from 'vitest';
import { snap, snapPoints, snapRange } from './snapping';
import { createSequence, createTitleClip } from '$lib/project/defaults';

function seq() {
  const s = createSequence({ name: 's', width: 1, height: 1, fps: 25 });
  s.tracks[0].clips.push(createTitleClip(2, 3, 'a'));
  s.tracks[1].clips.push(createTitleClip(10, 1, 'b'));
  s.markers.push({ id: 'm', time: 7, duration: 1, name: '', color: 'green', note: '' });
  s.inPoint = 1;
  s.outPoint = 12;
  return s;
}

describe('snapping', () => {
  it('collects points', () => {
    const points = snapPoints(seq(), { playhead: 4 });
    expect(points.map((p) => `${p.kind}@${p.time}`)).toEqual([
      'start@0', 'clip-start@2', 'clip-end@5', 'clip-start@10', 'clip-end@11', 'playhead@4', 'marker@7', 'marker@8', 'in@1', 'out@12'
    ]);
  });

  it('can leave out the dragged clips and markers', () => {
    const s = seq();
    const points = snapPoints(s, { excludeClipIds: [s.tracks[0].clips[0].id], includeMarkers: false });
    expect(points.map((p) => p.kind)).toEqual(['start', 'clip-start', 'clip-end', 'in', 'out']);
  });

  it('snaps to the closest point within tolerance', () => {
    const points = snapPoints(seq(), { playhead: 4 });
    expect(snap(4.9, points, 0.2)).toEqual({ time: 5, point: { time: 5, kind: 'clip-end' } });
    expect(snap(4.5, points, 0.2)).toEqual({ time: 4.5, point: null });
    expect(snap(4.45, points, 0.5).point?.kind).toBe('playhead');
  });

  it('snaps a range by its nearer edge', () => {
    const points = snapPoints(seq());
    // head at 1.92 is closer to the clip start at 2 than the tail (4.9) to 5
    expect(snapRange(1.92, 3, points, 0.2)).toMatchObject({ start: 2, edge: 'start' });
    const tail = snapRange(3.5, 6.4, points, 0.2);
    expect(tail.edge).toBe('end');
    expect(tail.start).toBeCloseTo(3.6, 9);
    expect(snapRange(20, 1, points, 0.2)).toEqual({ start: 20, point: null, edge: null });
  });
});
