import type { Id, Sequence } from '$lib/project/types';

export type SnapKind = 'clip-start' | 'clip-end' | 'playhead' | 'marker' | 'in' | 'out' | 'start';

export interface SnapPoint {
  time: number;
  kind: SnapKind;
}

export interface SnapPointOptions {
  // the clips being dragged should not snap to themselves
  excludeClipIds?: Id[];
  playhead?: number;
  includeMarkers?: boolean;
}

export function snapPoints(seq: Sequence, opts: SnapPointOptions = {}): SnapPoint[] {
  const exclude = new Set(opts.excludeClipIds ?? []);
  const points: SnapPoint[] = [{ time: 0, kind: 'start' }];
  for (const track of seq.tracks) {
    for (const clip of track.clips) {
      if (exclude.has(clip.id)) continue;
      points.push({ time: clip.start, kind: 'clip-start' });
      points.push({ time: clip.start + clip.duration, kind: 'clip-end' });
    }
  }
  if (opts.playhead !== undefined) points.push({ time: opts.playhead, kind: 'playhead' });
  if (opts.includeMarkers ?? true) {
    for (const marker of seq.markers) {
      points.push({ time: marker.time, kind: 'marker' });
      if (marker.duration > 0) points.push({ time: marker.time + marker.duration, kind: 'marker' });
    }
  }
  if (seq.inPoint !== null) points.push({ time: seq.inPoint, kind: 'in' });
  if (seq.outPoint !== null) points.push({ time: seq.outPoint, kind: 'out' });
  return points;
}

export interface SnapResult {
  time: number;
  point: SnapPoint | null;
}

// the closest point within tolerance wins, the playhead on a tie
export function snap(time: number, points: SnapPoint[], tolerance: number): SnapResult {
  let best: SnapPoint | null = null;
  let bestDistance = tolerance;
  for (const point of points) {
    const distance = Math.abs(point.time - time);
    if (distance < bestDistance || (distance === bestDistance && best && point.kind === 'playhead')) {
      best = point;
      bestDistance = distance;
    }
  }
  return best ? { time: best.time, point: best } : { time, point: null };
}

export interface SnapRangeResult {
  start: number;
  point: SnapPoint | null;
  edge: 'start' | 'end' | null;
}

// a dragged clip snaps with whichever of its edges is closer to something
export function snapRange(start: number, duration: number, points: SnapPoint[], tolerance: number): SnapRangeResult {
  const head = snap(start, points, tolerance);
  const tail = snap(start + duration, points, tolerance);
  const headDistance = head.point ? Math.abs(head.time - start) : Infinity;
  const tailDistance = tail.point ? Math.abs(tail.time - (start + duration)) : Infinity;
  if (head.point && headDistance <= tailDistance) return { start: head.time, point: head.point, edge: 'start' };
  if (tail.point) return { start: tail.time - duration, point: tail.point, edge: 'end' };
  return { start, point: null, edge: null };
}
