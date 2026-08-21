// the maths of the timeline and its public actions. pixel <-> time, ruler
// steps, row layout, hit zones live here so the components stay thin and
// the numbers can be tested without a dom. the actions at the bottom are
// what the shortcuts and the command palette call
import { get, writable } from 'svelte/store';
import type { Clip, Id, Sequence, Track, TrackKind } from '$lib/project/types';
import { activeSequence, clearSelection, editSequence } from '$lib/project/store';
import * as ops from '$lib/project/ops';
import { createMarker, sequenceDuration, clipEnd } from '$lib/project/defaults';
import { nearlyEqual, snapToFrame } from '$lib/project/time';
import { copyClips, cutClips, pasteClips } from '$lib/editor/clipboard';
import { addToast, playhead, selection, selectedTransitionId, timelineScroll, timelineZoom } from '$lib/stores/app';
import { preferences } from '$lib/stores/preferences';
import { defaultAudioTransition, defaultVideoTransition, transitionDef } from '$lib/engine/transitions/registry';

export const MIN_ZOOM = 5;
export const MAX_ZOOM = 2000;
// px at each clip edge that grab the trim handle instead of the body
export const TRIM_ZONE = 6;
export const SNAP_PX = 8;
// px around a cut where a dropped transition still lands on it
export const TRANSITION_DROP_PX = 12;
export const HEADER_W = 150;
export const RULER_H = 28;
export const MIN_TRACK_H = 24;
export const MAX_TRACK_H = 240;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function timeToX(time: number, zoom: number, scroll: number): number {
  return (time - scroll) * zoom;
}

export function xToTime(x: number, zoom: number, scroll: number): number {
  return Math.max(0, scroll + x / zoom);
}

export function snapTolerance(zoom: number): number {
  return SNAP_PX / zoom;
}

// the time under anchorX stays under anchorX after the zoom, so a wheel zoom
// grows around the pointer instead of running away to the left
export function zoomAround(zoom: number, scroll: number, nextZoom: number, anchorX: number): { zoom: number; scroll: number } {
  const z = clampZoom(nextZoom);
  const anchorTime = scroll + anchorX / zoom;
  return { zoom: z, scroll: Math.max(0, anchorTime - anchorX / z) };
}

export interface TrackRow {
  track: Track;
  top: number;
  height: number;
}

// video tracks are stacked top down from the highest layer, audio follows,
// the order every desktop nle uses
export function trackRows(seq: Sequence): TrackRow[] {
  const video = seq.tracks.filter((t) => t.kind === 'video').reverse();
  const audio = seq.tracks.filter((t) => t.kind === 'audio');
  const rows: TrackRow[] = [];
  let top = 0;
  for (const track of [...video, ...audio]) {
    rows.push({ track, top, height: track.height });
    top += track.height;
  }
  return rows;
}

export function rowAtY(rows: TrackRow[], y: number): TrackRow | null {
  for (const row of rows) if (y >= row.top && y < row.top + row.height) return row;
  return null;
}

export function rowOf(rows: TrackRow[], trackId: Id): TrackRow | null {
  return rows.find((r) => r.track.id === trackId) ?? null;
}

export function rowsHeight(rows: TrackRow[]): number {
  const last = rows[rows.length - 1];
  return last ? last.top + last.height : 0;
}

// position of a track among the tracks of its kind
export function kindIndex(seq: Sequence, trackId: Id): number {
  const track = seq.tracks.find((t) => t.id === trackId);
  if (!track) return -1;
  return seq.tracks.filter((t) => t.kind === track.kind).indexOf(track);
}

// the track offset places away among the same kind, clamped to what exists
export function siblingTrack(seq: Sequence, trackId: Id, offset: number): Track | null {
  const track = seq.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const same = seq.tracks.filter((t) => t.kind === track.kind);
  const index = Math.min(same.length - 1, Math.max(0, same.indexOf(track) + offset));
  return same[index] ?? null;
}

export function firstUnlockedTrack(seq: Sequence, kind: TrackKind): Track | null {
  return seq.tracks.find((t) => t.kind === kind && !t.locked) ?? null;
}

// how many tracks a group of clips can travel together before one of them
// would run past the first or last track of its kind. without this the ones
// at the edge pile onto the same track and overwrite each other
export function trackOffsetRange(seq: Sequence, trackIds: Iterable<Id>): { min: number; max: number } {
  let min = -Infinity;
  let max = Infinity;
  for (const trackId of trackIds) {
    const track = seq.tracks.find((t) => t.id === trackId);
    if (!track) continue;
    const count = seq.tracks.filter((t) => t.kind === track.kind).length;
    const index = kindIndex(seq, trackId);
    min = Math.max(min, -index);
    max = Math.min(max, count - 1 - index);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 };
  // negating a zero index gives -0, which compares equal but reads wrong
  return { min: min === 0 ? 0 : min, max: max === 0 ? 0 : max };
}

// candidate tick steps in seconds, frames first. the ruler picks the
// smallest one that leaves room for a label
function stepCandidates(fps: number): number[] {
  const frame = 1 / fps;
  return [
    frame, 2 * frame, 5 * frame, 10 * frame,
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 18000
  ];
}

export function rulerScale(zoom: number, fps: number): { major: number; minor: number } {
  const candidates = stepCandidates(fps);
  const major = candidates.find((c) => c * zoom >= 80) ?? candidates[candidates.length - 1];
  // the finest subdivision that still keeps ticks apart and divides the major step
  for (const c of candidates) {
    if (c >= major) break;
    if (c * zoom < 7) continue;
    const ratio = major / c;
    if (nearlyEqual(ratio, Math.round(ratio), 1e-3)) return { major, minor: c };
  }
  return { major, minor: major };
}

export interface Tick {
  time: number;
  major: boolean;
}

export function rulerTicks(scroll: number, zoom: number, width: number, fps: number): Tick[] {
  const { major, minor } = rulerScale(zoom, fps);
  const end = scroll + width / zoom;
  const first = Math.floor(scroll / minor);
  const last = Math.ceil(end / minor);
  const ticks: Tick[] = [];
  for (let i = Math.max(0, first); i <= last; i++) {
    const time = i * minor;
    const ratio = time / major;
    ticks.push({ time, major: nearlyEqual(ratio, Math.round(ratio), 1e-6) });
  }
  return ticks;
}

export type EdgeZone = 'head' | 'body' | 'tail';

// where on a clip the pointer went down. narrow clips keep a body in the
// middle so they can still be moved
export function edgeZone(localX: number, width: number): EdgeZone {
  const zone = Math.min(TRIM_ZONE, width / 3);
  if (localX < zone) return 'head';
  if (localX > width - zone) return 'tail';
  return 'body';
}

export function clipsInRange(clips: Clip[], from: number, to: number): Clip[] {
  return clips.filter((c) => c.start < to && clipEnd(c) > from);
}

export interface Cut {
  cut: number;
  leftClipId: Id | null;
  rightClipId: Id | null;
}

// the nearest clip edge within tolerance, with the clips on either side of it
export function cutNear(track: Track, time: number, tolerance: number): Cut | null {
  let best: Cut | null = null;
  let bestDistance = tolerance;
  const consider = (cut: number, leftClipId: Id | null, rightClipId: Id | null) => {
    const distance = Math.abs(cut - time);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = { cut, leftClipId, rightClipId };
    }
  };
  for (let i = 0; i < track.clips.length; i++) {
    const clip = track.clips[i];
    const prev = track.clips[i - 1];
    const next = track.clips[i + 1];
    if (!prev || !nearlyEqual(clipEnd(prev), clip.start)) consider(clip.start, null, clip.id);
    consider(clipEnd(clip), clip.id, next && nearlyEqual(next.start, clipEnd(clip)) ? next.id : null);
  }
  return best;
}

export interface Edge {
  clipId: Id;
  edge: 'head' | 'tail';
  time: number;
}

// the clips that share an edit with clip: itself and its linked partners
// that start or end at the same time
export function linkedEdges(seq: Sequence, clipId: Id, edge: 'head' | 'tail'): Edge[] {
  const found = ops.findClipById(seq, clipId);
  if (!found) return [];
  const time = edge === 'head' ? found.clip.start : clipEnd(found.clip);
  return ops
    .linkedClips(seq, clipId)
    .filter((c) => nearlyEqual(edge === 'head' ? c.start : clipEnd(c), time))
    .map((c) => ({ clipId: c.id, edge, time }));
}

export type BandKey = 'opacity' | 'volume';

export function bandKey(clip: Clip): BandKey {
  return clip.kind === 'audio' ? 'volume' : 'opacity';
}

// the rubber band maps opacity 0..100 and volume -60..12 db onto the clip height
const bandRange: Record<BandKey, { min: number; max: number }> = {
  opacity: { min: 0, max: 100 },
  volume: { min: -60, max: 12 }
};

export function bandValueToY(key: BandKey, value: number, height: number): number {
  const { min, max } = bandRange[key];
  const t = (Math.min(max, Math.max(min, value)) - min) / (max - min);
  return height - t * height;
}

export function yToBandValue(key: BandKey, y: number, height: number): number {
  const { min, max } = bandRange[key];
  const t = 1 - Math.min(height, Math.max(0, y)) / height;
  const value = min + t * (max - min);
  return key === 'opacity' ? Math.round(value) : Math.round(value * 10) / 10;
}

export function bandParam(key: BandKey): { effectType: string; param: string } {
  return key === 'opacity' ? { effectType: 'opacity', param: 'opacity' } : { effectType: 'volume', param: 'level' };
}

export function formatBandValue(key: BandKey, value: number): string {
  return key === 'opacity' ? `${Math.round(value)}%` : `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
}

export function zoomIn(viewportWidth: number): void {
  const zoom = get(timelineZoom);
  const next = zoomAround(zoom, get(timelineScroll), zoom * 1.5, viewportWidth / 2);
  timelineZoom.set(next.zoom);
  timelineScroll.set(next.scroll);
}

export function zoomOut(viewportWidth: number): void {
  const zoom = get(timelineZoom);
  const next = zoomAround(zoom, get(timelineScroll), zoom / 1.5, viewportWidth / 2);
  timelineZoom.set(next.zoom);
  timelineScroll.set(next.scroll);
}

// the zoom at which the whole sequence just fits the lanes. a little air on
// the right, and an empty sequence shows ten seconds
export function fitZoom(duration: number, viewportWidth: number): number {
  const span = duration > 0 ? duration * 1.04 : 10;
  return clampZoom(Math.max(1, viewportWidth - 8) / span);
}

export function zoomToFit(viewportWidth: number): void {
  const seq = get(activeSequence);
  timelineZoom.set(fitZoom(seq ? sequenceDuration(seq) : 0, viewportWidth));
  timelineScroll.set(0);
}

// how wide the lanes are right now. the timeline is the only writer; the
// status bar reads it to say what the zoom means
export const timelineViewport = writable(0);

// real material is mastered well below full scale, so peaks drawn as they are
// leave a flat line in the middle of the lane. every clip is drawn with its
// own peak as the gain instead. the floor keeps a nearly silent clip looking
// quiet and true silence flat, the headroom keeps the loudest sample just
// short of the lane edge
export const WAVE_FLOOR = 0.06;
export const WAVE_HEADROOM = 0.92;

// the loudest sample in a stretch of source, out of the min/max pairs the
// waveform worker leaves behind
export function peakOfRange(peaks: Float32Array, from: number, to: number, perSecond: number): number {
  const buckets = peaks.length / 2;
  const lo = Math.max(0, Math.floor(Math.min(from, to) * perSecond));
  const hi = Math.min(buckets, Math.ceil(Math.max(from, to) * perSecond));
  let peak = 0;
  for (let i = lo; i < hi; i++) {
    if (-peaks[2 * i] > peak) peak = -peaks[2 * i];
    if (peaks[2 * i + 1] > peak) peak = peaks[2 * i + 1];
  }
  return peak;
}

export function waveformGain(peak: number): number {
  return peak > 0 ? WAVE_HEADROOM / Math.max(peak, WAVE_FLOOR) : 0;
}

function seq(): Sequence | null {
  return get(activeSequence);
}

// the selection already follows links, this just makes sure of it after
// edits that may have relinked things
function selectedIds(s: Sequence): Id[] {
  const ids = new Set<Id>();
  for (const cid of get(selection)) {
    for (const linked of ops.linkedClips(s, cid)) ids.add(linked.id);
  }
  return [...ids];
}

// the session is only loaded on demand so this module stays importable in
// node, where the tests run
async function seekTo(time: number): Promise<void> {
  const { program } = await import('$lib/engine/session');
  program().player.seek(time);
}

function defaultTransition(kind: TrackKind): { type: string; duration: number } {
  const prefs = get(preferences);
  const wanted = kind === 'video' ? prefs.defaultVideoTransition : prefs.defaultAudioTransition;
  const type = transitionDef(wanted) ? wanted : kind === 'video' ? defaultVideoTransition : defaultAudioTransition;
  return { type, duration: Math.max(0.04, prefs.defaultTransitionDuration) };
}

export interface EditPoint {
  trackId: Id;
  cut: Cut;
}

// both edges of a clip as edit points: joined to the neighbour where there
// is one, from or to black otherwise
export function editPointsOfClip(s: Sequence, clipId: Id): EditPoint[] {
  const found = ops.findClipById(s, clipId);
  if (!found || found.track.locked) return [];
  const { clip, track } = found;
  const index = track.clips.indexOf(clip);
  const prev = track.clips[index - 1];
  const next = track.clips[index + 1];
  const head = prev && nearlyEqual(clipEnd(prev), clip.start) ? prev.id : null;
  const tail = next && nearlyEqual(next.start, clipEnd(clip)) ? next.id : null;
  return [
    { trackId: track.id, cut: { cut: clip.start, leftClipId: head, rightClipId: clip.id } },
    { trackId: track.id, cut: { cut: clipEnd(clip), leftClipId: clip.id, rightClipId: tail } }
  ];
}

// the edit point closest to time among a list, so one keypress puts one
// transition where the playhead is rather than on every edge it can find
export function nearestEditPoint(points: EditPoint[], time: number): EditPoint | null {
  let best: EditPoint | null = null;
  for (const point of points) {
    if (!best || Math.abs(point.cut.cut - time) < Math.abs(best.cut.cut - time)) best = point;
  }
  return best;
}

export const timelineActions = {
  selectAll(): void {
    const s = seq();
    if (!s) return;
    const ids: Id[] = [];
    for (const track of s.tracks) for (const clip of track.clips) ids.push(clip.id);
    selection.set(ids);
  },

  deleteSelection(): void {
    const s = seq();
    if (!s) return;
    const ids = selectedIds(s);
    if (ids.length === 0) {
      const transitionId = get(selectedTransitionId);
      if (!transitionId) return;
      editSequence('delete transition', (d) => ops.removeTransition(d, transitionId));
      selectedTransitionId.set(null);
      return;
    }
    editSequence('delete clips', (d) => ops.deleteClips(d, ids));
    clearSelection();
  },

  rippleDeleteSelection(): void {
    const s = seq();
    if (!s) return;
    const ids = selectedIds(s);
    if (ids.length === 0) return;
    editSequence('ripple delete', (d) => ops.rippleDelete(d, ids));
    clearSelection();
  },

  // selected clips split at the playhead, or everything under it when
  // nothing is selected or all tracks are asked for
  splitAtPlayhead(allTracks = false): void {
    const s = seq();
    if (!s) return;
    const time = get(playhead);
    const ids = allTracks ? [] : selectedIds(s);
    editSequence('split clips', (d) => ops.splitClipsAt(d, time, ids.length ? ids : 'all-unlocked'));
  },

  addMarkerAtPlayhead(): void {
    const time = get(playhead);
    editSequence('add marker', (d) => ops.addMarker(d, createMarker(time)));
  },

  goToNextEdit(): number | null {
    const s = seq();
    if (!s) return null;
    const time = ops.nextEdit(s, get(playhead));
    if (time !== null) void seekTo(time);
    return time;
  },

  goToPrevEdit(): number | null {
    const s = seq();
    if (!s) return null;
    const time = ops.prevEdit(s, get(playhead));
    if (time !== null) void seekTo(time);
    return time;
  },

  liftInOut(): void {
    const s = seq();
    if (!s) return;
    if (s.inPoint === null || s.outPoint === null) {
      addToast('Mark in and out points first', 'warning');
      return;
    }
    const [from, to] = [s.inPoint, s.outPoint];
    editSequence('lift', (d) => ops.liftRange(d, from, to));
  },

  extractInOut(): void {
    const s = seq();
    if (!s) return;
    if (s.inPoint === null || s.outPoint === null) {
      addToast('Mark in and out points first', 'warning');
      return;
    }
    const [from, to] = [s.inPoint, s.outPoint];
    editSequence('extract', (d) => ops.extractRange(d, from, to));
  },

  nudgeSelection(frames: number): void {
    const s = seq();
    if (!s || frames === 0) return;
    const ids = selectedIds(s);
    if (ids.length === 0) return;
    const delta = frames / s.fps;
    const moves: ops.ClipMove[] = [];
    for (const cid of ids) {
      const found = ops.findClipById(s, cid);
      if (found) moves.push({ clipId: cid, trackId: found.track.id, start: Math.max(0, found.clip.start + delta) });
    }
    editSequence('nudge clips', (d) => ops.moveClips(d, moves, 'overwrite', { keepLinked: false }));
  },

  // exactly one transition, on the edit point nearest the playhead: among the
  // edges of the selection when there is one, on any track of that kind
  // otherwise. two edges at once is what a drag on each of them is for
  addDefaultTransition(kind: TrackKind): void {
    const s = seq();
    if (!s) return;
    const { type, duration } = defaultTransition(kind);
    const time = get(playhead);
    const ids = selectedIds(s).filter((cid) => ops.trackOf(s, cid)?.kind === kind);
    const points: EditPoint[] = [];
    if (ids.length) {
      for (const cid of ids) points.push(...editPointsOfClip(s, cid));
    } else {
      for (const track of s.tracks) {
        if (track.kind !== kind || track.locked) continue;
        const cut = cutNear(track, time, Infinity);
        if (cut) points.push({ trackId: track.id, cut });
      }
    }
    const target = nearestEditPoint(points, time);
    let added = 0;
    if (target) {
      editSequence('add transition', (d) => {
        if (ops.addTransition(d, target.trackId, { type, ...target.cut, duration })) added++;
      });
    }
    if (added === 0) addToast('No edit point to put a transition on', 'info');
  },

  linkSelection(): void {
    const s = seq();
    if (!s) return;
    const ids = selectedIds(s);
    if (ids.length === 0) return;
    const clips = ids.map((cid) => ops.findClipById(s, cid)?.clip).filter((c): c is Clip => !!c);
    const linked = clips.every((c) => c.linkId !== null && c.linkId === clips[0].linkId);
    if (linked) {
      editSequence('unlink clips', (d) => ops.unlinkClips(d, ids));
    } else if (ids.length >= 2) {
      editSequence('link clips', (d) => ops.linkClips(d, ids));
    } else {
      addToast('Select two or more clips to link them', 'info');
    }
  },

  toggleEnabled(): void {
    const s = seq();
    if (!s) return;
    const ids = selectedIds(s);
    if (ids.length === 0) return;
    const first = ops.findClipById(s, ids[0])?.clip;
    if (!first) return;
    const enabled = !first.enabled;
    editSequence(enabled ? 'enable clips' : 'disable clips', (d) => ops.setEnabled(d, ids, enabled));
  },

  closeGapAtPlayhead(): void {
    const s = seq();
    if (!s) return;
    const time = get(playhead);
    let closed = false;
    editSequence('close gap', (d) => {
      for (const track of d.tracks) if (ops.closeGap(d, track.id, time)) closed = true;
    });
    if (!closed) addToast('No gap under the playhead', 'info');
  },

  copySelection(): number {
    const s = seq();
    if (!s) return 0;
    return copyClips(s, selectedIds(s));
  },

  cutSelection(): void {
    const s = seq();
    if (!s) return;
    const ids = selectedIds(s);
    if (ids.length === 0) return;
    editSequence('cut clips', (d) => cutClips(d, ids));
    clearSelection();
  },

  pasteAtPlayhead(trackHint?: Id): void {
    const time = get(playhead);
    let placed: Id[] = [];
    editSequence('paste clips', (d) => {
      placed = pasteClips(d, time, { trackHint });
    });
    if (placed.length) selection.set(placed);
  },

  zoomIn(viewportWidth: number): void {
    zoomIn(viewportWidth);
  },

  zoomOut(viewportWidth: number): void {
    zoomOut(viewportWidth);
  },

  zoomToFit(viewportWidth: number): void {
    zoomToFit(viewportWidth);
  }
};

// a frame-aligned time for razor cuts and marker drops
export function frameTime(time: number, fps: number): number {
  return Math.max(0, snapToFrame(time, fps));
}
