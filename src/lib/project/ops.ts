// editing operations on a sequence. every function mutates the sequence it
// gets (an immer draft in the app, a plain object in tests) and keeps the
// invariants of the model: clips sorted, never overlapping, on the frame
// grid, transitions only where their cut still exists
import { id } from './ids';
import type { Clip, Id, Label, MediaItem, Marker, Sequence, Track, TrackKind, Transition } from './types';
import { frameDuration, nearlyEqual, snapToFrame } from './time';
import { clipEnd, createTrack, sequenceDuration } from './defaults';

export { clipEnd, sequenceDuration };

export type GetMedia = (mediaId: Id) => MediaItem | undefined;

export interface MediaOptions {
  getMedia?: GetMedia;
}

// float noise is far below a frame, so anything closer than this is "the same time"
const TOL = 1e-6;

function snap(seq: Sequence, time: number): number {
  return snapToFrame(time, seq.fps);
}

function sortTrack(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start);
  track.transitions.sort((a, b) => a.start - b.start);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function findClipById(seq: Sequence, clipId: Id): { clip: Clip; track: Track } | null {
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

export function trackOf(seq: Sequence, clipId: Id): Track | null {
  return findClipById(seq, clipId)?.track ?? null;
}

export function trackById(seq: Sequence, trackId: Id): Track | null {
  return seq.tracks.find((t) => t.id === trackId) ?? null;
}

export function linkedClips(seq: Sequence, clipId: Id): Clip[] {
  const found = findClipById(seq, clipId);
  if (!found) return [];
  if (!found.clip.linkId) return [found.clip];
  const linkId = found.clip.linkId;
  const out: Clip[] = [];
  for (const track of seq.tracks) for (const clip of track.clips) if (clip.linkId === linkId) out.push(clip);
  return out;
}

export function clipAt(track: Track, time: number): Clip | null {
  return track.clips.find((c) => c.start <= time + TOL && clipEnd(c) > time + TOL) ?? null;
}

export function clipsAt(seq: Sequence, time: number): Clip[] {
  const out: Clip[] = [];
  for (const track of seq.tracks) {
    const clip = clipAt(track, time);
    if (clip) out.push(clip);
  }
  return out;
}

function clipKindFits(clip: Clip, track: Track): boolean {
  return (clip.kind === 'audio') === (track.kind === 'audio');
}

// source-side limits for clips that read a file: how far in can move and
// how long the clip may get at its current speed. null means unbounded
export function mediaBound(clip: Clip, media: MediaItem | undefined): { maxIn: number; maxDuration: number } | null {
  if (clip.kind !== 'video' && clip.kind !== 'audio') return null;
  if (!media || media.duration <= 0) return null;
  return {
    maxIn: Math.max(0, media.duration - clip.duration * clip.speed),
    maxDuration: Math.max(0, (media.duration - clip.in) / clip.speed)
  };
}

function mediaFor(clip: Clip, opts: MediaOptions): MediaItem | undefined {
  return clip.mediaId && opts.getMedia ? opts.getMedia(clip.mediaId) : undefined;
}

// the source range a clip covers, regardless of direction
function sourceSpan(clip: Clip): number {
  return clip.duration * clip.speed;
}

// drop delta seconds from the head of a clip. a reversed clip plays its
// source backwards, so the head holds the end of the source range and in
// stays where it is
function trimHead(clip: Clip, delta: number): void {
  clip.start += delta;
  clip.duration -= delta;
  if (!clip.reverse) clip.in += delta * clip.speed;
  shiftKeyframes(clip, -delta);
}

function trimTail(clip: Clip, delta: number): void {
  clip.duration -= delta;
  if (clip.reverse) clip.in += delta * clip.speed;
}

function shiftKeyframes(clip: Clip, delta: number): void {
  if (delta === 0) return;
  for (const effect of clip.effects) {
    for (const key of Object.keys(effect.keyframes)) {
      for (const kf of effect.keyframes[key]) kf.time += delta;
    }
  }
}

function minDuration(seq: Sequence): number {
  return frameDuration(seq.fps);
}

// cut a clip in two at time and return the right half, which is inserted
// right after the left one. the left half keeps the id
function splitClip(seq: Sequence, track: Track, clip: Clip, time: number, linkMap?: Map<Id, Id>): Clip | null {
  const t = snap(seq, time);
  if (t <= clip.start + TOL || t >= clipEnd(clip) - TOL) return null;
  const right = clone(clip);
  right.id = id();
  const leftDuration = t - clip.start;
  right.start = t;
  right.duration = clip.duration - leftDuration;
  if (clip.reverse) {
    clip.in += right.duration * clip.speed;
  } else {
    right.in = clip.in + leftDuration * clip.speed;
  }
  clip.duration = leftDuration;
  shiftKeyframes(right, -leftDuration);
  if (clip.linkId && linkMap) {
    const mapped = linkMap.get(clip.linkId) ?? id();
    linkMap.set(clip.linkId, mapped);
    right.linkId = mapped;
  }
  // a transition at the tail of the clip now belongs to the right half
  for (const tr of track.transitions) {
    if (tr.leftClipId === clip.id && tr.start + tr.duration > t + TOL) tr.leftClipId = right.id;
  }
  const index = track.clips.indexOf(clip);
  track.clips.splice(index + 1, 0, right);
  return right;
}

// make room for [start, end) on a track: whatever is under it gets trimmed,
// split or removed. this is what an overwrite edit does
function clearRange(seq: Sequence, track: Track, start: number, end: number, ignoreIds: ReadonlySet<Id> = new Set()): void {
  if (end - start <= TOL) return;
  const keep: Clip[] = [];
  for (const clip of [...track.clips]) {
    if (ignoreIds.has(clip.id)) {
      keep.push(clip);
      continue;
    }
    const cStart = clip.start;
    const cEnd = clipEnd(clip);
    if (cEnd <= start + TOL || cStart >= end - TOL) {
      keep.push(clip);
    } else if (cStart >= start - TOL && cEnd <= end + TOL) {
      continue;
    } else if (cStart < start - TOL && cEnd > end + TOL) {
      // the range sits inside the clip: two pieces remain
      const right = clone(clip);
      right.id = id();
      const leftDuration = start - cStart;
      const rightDuration = cEnd - end;
      right.start = end;
      right.duration = rightDuration;
      if (clip.reverse) {
        right.in = clip.in;
        clip.in += (clip.duration - leftDuration) * clip.speed;
      } else {
        right.in = clip.in + (end - cStart) * clip.speed;
      }
      clip.duration = leftDuration;
      shiftKeyframes(right, -(end - cStart));
      for (const tr of track.transitions) if (tr.leftClipId === clip.id) tr.leftClipId = right.id;
      keep.push(clip, right);
    } else if (cStart < start - TOL) {
      trimTail(clip, cEnd - start);
      keep.push(clip);
    } else {
      trimHead(clip, end - cStart);
      keep.push(clip);
    }
  }
  track.clips = keep;
  sortTrack(track);
}

function rangeEmpty(track: Track, start: number, end: number, ignoreIds: ReadonlySet<Id> = new Set()): boolean {
  return !track.clips.some((c) => !ignoreIds.has(c.id) && c.start < end - TOL && clipEnd(c) > start + TOL);
}

export function canPlace(seq: Sequence, trackId: Id, start: number, duration: number, ignoreIds: Id[] = []): boolean {
  const track = trackById(seq, trackId);
  if (!track || track.locked) return false;
  return rangeEmpty(track, start, start + duration, new Set(ignoreIds));
}

interface RippleOptions {
  // tracks that shift no matter what (the track the edit happened on)
  forceTrackIds?: ReadonlySet<Id>;
  // insert edits cut through clips that span the point, trims just push
  split?: boolean;
  ignoreIds?: ReadonlySet<Id>;
}

// shift everything at or after time by delta on every unlocked track. a
// negative delta only moves a track if the range it would close is empty
// there, so nothing ever slides under another clip
function ripple(seq: Sequence, time: number, delta: number, opts: RippleOptions = {}): void {
  if (Math.abs(delta) <= TOL) return;
  const ignore = opts.ignoreIds ?? new Set<Id>();
  for (const track of seq.tracks) {
    if (track.locked) continue;
    const forced = opts.forceTrackIds?.has(track.id) ?? false;
    if (delta < 0 && !forced && !rangeEmpty(track, time + delta, time, ignore)) continue;
    if (opts.split && delta > 0) {
      const spanning = track.clips.find((c) => !ignore.has(c.id) && c.start < time - TOL && clipEnd(c) > time + TOL);
      if (spanning) splitClip(seq, track, spanning, time);
    }
    for (const clip of track.clips) {
      if (ignore.has(clip.id)) continue;
      if (clip.start >= time - TOL) clip.start = snap(seq, clip.start + delta);
    }
    for (const tr of track.transitions) {
      if (tr.start + tr.duration / 2 >= time - TOL) tr.start = snap(seq, tr.start + delta);
    }
    sortTrack(track);
  }
  validateTransitions(seq);
}

function placeOnTrack(seq: Sequence, track: Track, clip: Clip, time: number): void {
  clip.start = snap(seq, time);
  clip.duration = Math.max(minDuration(seq), snap(seq, clip.duration));
  track.clips.push(clip);
  sortTrack(track);
}

export function overwriteClip(seq: Sequence, trackId: Id, clip: Clip, time: number): boolean {
  const track = trackById(seq, trackId);
  if (!track || track.locked || !clipKindFits(clip, track)) return false;
  const start = snap(seq, time);
  const duration = Math.max(minDuration(seq), snap(seq, clip.duration));
  clearRange(seq, track, start, start + duration);
  placeOnTrack(seq, track, clip, start);
  validateTransitions(seq);
  return true;
}

// an insert edit pushes everything after time to the right on all unlocked
// tracks, cutting through clips that span the point, like a desktop nle
export function insertClip(seq: Sequence, trackId: Id, clip: Clip, time: number): boolean {
  const track = trackById(seq, trackId);
  if (!track || track.locked || !clipKindFits(clip, track)) return false;
  const start = snap(seq, time);
  const duration = Math.max(minDuration(seq), snap(seq, clip.duration));
  ripple(seq, start, duration, { split: true });
  placeOnTrack(seq, track, clip, start);
  validateTransitions(seq);
  return true;
}

export interface Placement {
  trackId: Id;
  clip: Clip;
}

// several clips at once (a video clip and its linked audio). in insert mode
// the ripple happens once for the whole span they cover
export function placeClips(seq: Sequence, placements: Placement[], mode: 'insert' | 'overwrite'): Id[] {
  const valid = placements.filter((p) => {
    const track = trackById(seq, p.trackId);
    return track && !track.locked && clipKindFits(p.clip, track);
  });
  if (valid.length === 0) return [];
  if (mode === 'insert') {
    const from = Math.min(...valid.map((p) => p.clip.start));
    const to = Math.max(...valid.map((p) => clipEnd(p.clip)));
    ripple(seq, snap(seq, from), snap(seq, to) - snap(seq, from), { split: true });
  }
  const placed: Id[] = [];
  for (const p of valid) {
    if (overwriteClip(seq, p.trackId, p.clip, p.clip.start)) placed.push(p.clip.id);
  }
  return placed;
}

export interface ClipMove {
  clipId: Id;
  trackId: Id;
  start: number;
}

export interface MoveOptions {
  // drag the linked audio/video along, on its own track, by the same distance
  keepLinked?: boolean;
}

export function moveClips(seq: Sequence, moves: ClipMove[], mode: 'overwrite' | 'insert', opts: MoveOptions = {}): boolean {
  const byId = new Map<Id, ClipMove>();
  for (const m of moves) byId.set(m.clipId, m);
  if (opts.keepLinked ?? true) {
    for (const m of moves) {
      const origin = findClipById(seq, m.clipId);
      if (!origin) continue;
      const delta = snap(seq, m.start) - origin.clip.start;
      for (const linked of linkedClips(seq, m.clipId)) {
        if (byId.has(linked.id)) continue;
        const track = trackOf(seq, linked.id);
        if (!track) continue;
        byId.set(linked.id, { clipId: linked.id, trackId: track.id, start: linked.start + delta });
      }
    }
  }

  const placements: Placement[] = [];
  for (const m of byId.values()) {
    const origin = findClipById(seq, m.clipId);
    const target = trackById(seq, m.trackId);
    if (!origin || !target || origin.track.locked || target.locked || !clipKindFits(origin.clip, target)) return false;
    if (m.start < -TOL) return false;
  }
  for (const m of byId.values()) {
    const origin = findClipById(seq, m.clipId)!;
    origin.track.clips = origin.track.clips.filter((c) => c.id !== m.clipId);
    const clip = clone(origin.clip);
    clip.start = snap(seq, m.start);
    placements.push({ trackId: m.trackId, clip });
  }
  placeClips(seq, placements, mode);
  validateTransitions(seq);
  return true;
}

export interface TrimOptions extends MediaOptions {
  ripple?: boolean;
}

function neighbours(track: Track, clip: Clip): { prev: Clip | null; next: Clip | null } {
  const index = track.clips.indexOf(clip);
  return { prev: track.clips[index - 1] ?? null, next: track.clips[index + 1] ?? null };
}

// the earliest start a head trim can reach: previous clip, source start,
// sequence start, and at least a frame of clip left
function headLimits(seq: Sequence, track: Track, clip: Clip, opts: TrimOptions): { min: number; max: number } {
  const { prev } = neighbours(track, clip);
  let min = prev ? clipEnd(prev) : 0;
  const media = mediaFor(clip, opts);
  if (media && mediaBound(clip, media)) {
    if (clip.reverse) {
      // the head holds the end of the source range
      min = Math.max(min, clipEnd(clip) - (media.duration - clip.in) / clip.speed);
    } else {
      min = Math.max(min, clip.start - clip.in / clip.speed);
    }
  }
  return { min: snap(seq, min), max: snap(seq, clipEnd(clip) - minDuration(seq)) };
}

function tailLimits(seq: Sequence, track: Track, clip: Clip, opts: TrimOptions): { min: number; max: number } {
  const { next } = neighbours(track, clip);
  let max = next && !opts.ripple ? next.start : Infinity;
  const media = mediaFor(clip, opts);
  if (media && mediaBound(clip, media)) {
    if (clip.reverse) {
      max = Math.min(max, clip.start + (clip.in + sourceSpan(clip)) / clip.speed);
    } else {
      max = Math.min(max, clip.start + (media.duration - clip.in) / clip.speed);
    }
  }
  return { min: snap(seq, clip.start + minDuration(seq)), max: Number.isFinite(max) ? snap(seq, max) : max };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function trimClipStart(seq: Sequence, clipId: Id, newStart: number, opts: TrimOptions = {}): number | null {
  const found = findClipById(seq, clipId);
  if (!found || found.track.locked) return null;
  const { clip, track } = found;
  const limits = headLimits(seq, track, clip, opts);
  const target = clamp(snap(seq, newStart), limits.min, limits.max);
  const delta = target - clip.start;
  if (Math.abs(delta) <= TOL) return clip.start;
  const oldStart = clip.start;
  const oldEnd = clipEnd(clip);
  trimHead(clip, delta);
  if (opts.ripple) {
    // the clip stays where it was, what changes is what comes after it
    clip.start = oldStart;
    sortTrack(track);
    ripple(seq, oldEnd, -delta, { forceTrackIds: new Set([track.id]), ignoreIds: new Set([clip.id]) });
  }
  sortTrack(track);
  validateTransitions(seq);
  return clip.start;
}

export function trimClipEnd(seq: Sequence, clipId: Id, newEnd: number, opts: TrimOptions = {}): number | null {
  const found = findClipById(seq, clipId);
  if (!found || found.track.locked) return null;
  const { clip, track } = found;
  const limits = tailLimits(seq, track, clip, opts);
  const target = clamp(snap(seq, newEnd), limits.min, limits.max);
  const oldEnd = clipEnd(clip);
  const delta = target - oldEnd;
  if (Math.abs(delta) <= TOL) return oldEnd;
  if (opts.ripple) {
    ripple(seq, oldEnd, delta, { forceTrackIds: new Set([track.id]), ignoreIds: new Set([clip.id]) });
  }
  trimTail(clip, -delta);
  clip.duration = snap(seq, clip.duration);
  validateTransitions(seq);
  return clipEnd(clip);
}

// move the cut between two adjacent clips without changing anything else
export function rollEdit(seq: Sequence, leftClipId: Id, rightClipId: Id, newCut: number, opts: MediaOptions = {}): number | null {
  const left = findClipById(seq, leftClipId);
  const right = findClipById(seq, rightClipId);
  if (!left || !right || left.track.locked || right.track.locked) return null;
  if (!nearlyEqual(clipEnd(left.clip), right.clip.start)) return null;
  const leftLimits = tailLimits(seq, left.track, left.clip, { ...opts, ripple: true });
  const rightLimits = headLimits(seq, right.track, right.clip, opts);
  const min = Math.max(leftLimits.min, rightLimits.min);
  const max = Math.min(leftLimits.max, rightLimits.max);
  if (min > max + TOL) return null;
  const cut = clamp(snap(seq, newCut), min, max);
  const delta = cut - right.clip.start;
  if (Math.abs(delta) <= TOL) return cut;
  trimTail(left.clip, -delta);
  trimHead(right.clip, delta);
  validateTransitions(seq);
  return cut;
}

// change which part of the source a clip shows, keeping its place and length
export function slipClip(seq: Sequence, clipId: Id, deltaSourceSeconds: number, opts: MediaOptions = {}): number | null {
  const found = findClipById(seq, clipId);
  if (!found || found.track.locked) return null;
  const { clip } = found;
  const bound = mediaBound(clip, mediaFor(clip, opts));
  const maxIn = bound ? bound.maxIn : Infinity;
  clip.in = clamp(snap(seq, clip.in + deltaSourceSeconds), 0, maxIn);
  return clip.in;
}

// move a clip between its neighbours: they give and take the length
export function slideClip(seq: Sequence, clipId: Id, delta: number, opts: MediaOptions = {}): number | null {
  const found = findClipById(seq, clipId);
  if (!found || found.track.locked) return null;
  const { clip, track } = found;
  const { prev, next } = neighbours(track, clip);
  const prevAdjacent = prev !== null && nearlyEqual(clipEnd(prev), clip.start);
  const nextAdjacent = next !== null && nearlyEqual(next.start, clipEnd(clip));
  let d = snap(seq, delta);
  const frame = minDuration(seq);
  if (d < 0) {
    let min = prev ? (prevAdjacent ? prev.start + frame - clip.start : clipEnd(prev) - clip.start) : -clip.start;
    if (prev && prevAdjacent) {
      const limits = tailLimits(seq, track, prev, { ...opts, ripple: true });
      min = Math.max(min, limits.min - clipEnd(prev));
    }
    d = Math.max(d, min);
  } else if (d > 0) {
    let max = next ? (nextAdjacent ? clipEnd(next) - frame - clipEnd(clip) : next.start - clipEnd(clip)) : Infinity;
    if (next && nextAdjacent) {
      const limits = headLimits(seq, track, next, opts);
      max = Math.min(max, limits.max - next.start);
    }
    d = Math.min(d, max);
  }
  d = snap(seq, d);
  if (Math.abs(d) <= TOL) return clip.start;
  if (prev && prevAdjacent) trimTail(prev, -d);
  if (next && nextAdjacent) trimHead(next, d);
  clip.start = snap(seq, clip.start + d);
  sortTrack(track);
  validateTransitions(seq);
  return clip.start;
}

export function splitClipsAt(seq: Sequence, time: number, clipIds: Id[] | 'all-unlocked' = 'all-unlocked'): Id[] {
  const t = snap(seq, time);
  const created: Id[] = [];
  // halves of linked clips stay linked to each other, not to the originals
  const linkMap = new Map<Id, Id>();
  const wanted = clipIds === 'all-unlocked' ? null : new Set(clipIds);
  for (const track of seq.tracks) {
    if (track.locked) continue;
    for (const clip of [...track.clips]) {
      if (wanted && !wanted.has(clip.id)) continue;
      const right = splitClip(seq, track, clip, t, linkMap);
      if (right) created.push(right.id);
    }
  }
  validateTransitions(seq);
  return created;
}

export function deleteClips(seq: Sequence, clipIds: Id[]): void {
  const ids = new Set(clipIds);
  for (const track of seq.tracks) {
    if (track.locked) continue;
    track.clips = track.clips.filter((c) => !ids.has(c.id));
  }
  validateTransitions(seq);
}

// delete and close the gap. the clip's own track always closes, other
// tracks only when the range is empty there
export function rippleDelete(seq: Sequence, clipIds: Id[]): void {
  // clips that cover the same range (linked audio and video) close their
  // gap together, otherwise the second one would ripple the tracks twice
  const groups = new Map<string, { start: number; end: number; trackIds: Set<Id>; clipIds: Set<Id> }>();
  for (const clipId of clipIds) {
    const found = findClipById(seq, clipId);
    if (!found || found.track.locked) continue;
    const key = `${found.clip.start.toFixed(6)}-${clipEnd(found.clip).toFixed(6)}`;
    const group = groups.get(key) ?? { start: found.clip.start, end: clipEnd(found.clip), trackIds: new Set(), clipIds: new Set() };
    group.trackIds.add(found.track.id);
    group.clipIds.add(clipId);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => b.start - a.start);
  for (const group of ordered) {
    for (const track of seq.tracks) track.clips = track.clips.filter((c) => !group.clipIds.has(c.id));
    ripple(seq, group.end, group.start - group.end, { forceTrackIds: group.trackIds });
  }
  validateTransitions(seq);
}

function targetTracks(seq: Sequence, trackIds: Id[] | undefined): Track[] {
  const wanted = trackIds ? new Set(trackIds) : null;
  return seq.tracks.filter((t) => !t.locked && (!wanted || wanted.has(t.id)));
}

export function liftRange(seq: Sequence, inPoint: number, outPoint: number, trackIds?: Id[]): void {
  const from = snap(seq, inPoint);
  const to = snap(seq, outPoint);
  if (to - from <= TOL) return;
  for (const track of targetTracks(seq, trackIds)) clearRange(seq, track, from, to);
  validateTransitions(seq);
}

export function extractRange(seq: Sequence, inPoint: number, outPoint: number, trackIds?: Id[]): void {
  const from = snap(seq, inPoint);
  const to = snap(seq, outPoint);
  if (to - from <= TOL) return;
  const tracks = targetTracks(seq, trackIds);
  for (const track of tracks) clearRange(seq, track, from, to);
  ripple(seq, to, from - to, { forceTrackIds: new Set(tracks.map((t) => t.id)) });
}

export function linkClips(seq: Sequence, clipIds: Id[]): Id | null {
  const clips = clipIds.map((cid) => findClipById(seq, cid)?.clip).filter((c): c is Clip => !!c);
  if (clips.length < 2) return null;
  const linkId = id();
  for (const clip of clips) clip.linkId = linkId;
  return linkId;
}

export function unlinkClips(seq: Sequence, clipIds: Id[]): void {
  for (const cid of clipIds) {
    for (const clip of linkedClips(seq, cid)) clip.linkId = null;
  }
}

export interface SpeedOptions extends MediaOptions {
  reverse?: boolean;
  rippleDurationChange?: boolean;
}

// keeps the source range and changes how long it takes to play. applies to
// the linked clips too, so audio and video stay in step
export function setClipSpeed(seq: Sequence, clipId: Id, speed: number, opts: SpeedOptions = {}): boolean {
  if (!(speed > 0)) return false;
  const group = linkedClips(seq, clipId)
    .map((clip) => ({ clip, track: trackOf(seq, clip.id)! }))
    .filter((g) => !g.track.locked);
  if (group.length === 0) return false;
  const newDuration = (clip: Clip) => Math.max(minDuration(seq), snap(seq, sourceSpan(clip) / speed));
  if (opts.rippleDurationChange) {
    const primary = group.find((g) => g.clip.id === clipId) ?? group[0];
    ripple(seq, clipEnd(primary.clip), newDuration(primary.clip) - primary.clip.duration, {
      forceTrackIds: new Set(group.map((g) => g.track.id)),
      ignoreIds: new Set(group.map((g) => g.clip.id))
    });
  }
  for (const { clip, track } of group) {
    let duration = newDuration(clip);
    const { next } = neighbours(track, clip);
    if (!opts.rippleDurationChange && next && clip.start + duration > next.start + TOL) {
      duration = snap(seq, next.start - clip.start);
    }
    // in stays the source start of the range whichever way it plays
    clip.speed = speed;
    clip.duration = duration;
    if (opts.reverse !== undefined) clip.reverse = opts.reverse;
    sortTrack(track);
  }
  validateTransitions(seq);
  return true;
}

export function setEnabled(seq: Sequence, clipIds: Id[], enabled: boolean): void {
  for (const cid of clipIds) {
    const found = findClipById(seq, cid);
    if (found) found.clip.enabled = enabled;
  }
}

export function setLabel(seq: Sequence, clipIds: Id[], label: Label): void {
  for (const cid of clipIds) {
    const found = findClipById(seq, cid);
    if (found) found.clip.label = label;
  }
}

// track names follow their position: V1 is always the bottom video track
function renumberTracks(seq: Sequence): void {
  let v = 0;
  let a = 0;
  for (const track of seq.tracks) {
    const index = track.kind === 'video' ? v++ : a++;
    const numbered = /^[VA]\d+$/.test(track.name);
    if (numbered) track.name = `${track.kind === 'video' ? 'V' : 'A'}${index + 1}`;
  }
}

function tracksOfKind(seq: Sequence, kind: TrackKind): Track[] {
  return seq.tracks.filter((t) => t.kind === kind);
}

export function addTrack(seq: Sequence, kind: TrackKind, opts: { index?: number } = {}): Id {
  const same = tracksOfKind(seq, kind);
  const index = clamp(opts.index ?? same.length, 0, same.length);
  const track = createTrack(kind, index);
  let position: number;
  if (index < same.length) {
    position = seq.tracks.indexOf(same[index]);
  } else if (kind === 'video') {
    position = same.length;
  } else {
    position = seq.tracks.length;
  }
  seq.tracks.splice(position, 0, track);
  renumberTracks(seq);
  return track.id;
}

export function removeTrack(seq: Sequence, trackId: Id): boolean {
  const track = trackById(seq, trackId);
  if (!track || track.locked) return false;
  if (tracksOfKind(seq, track.kind).length <= 1) return false;
  seq.tracks = seq.tracks.filter((t) => t.id !== trackId);
  renumberTracks(seq);
  return true;
}

export function renameTrack(seq: Sequence, trackId: Id, name: string): void {
  const track = trackById(seq, trackId);
  if (track) track.name = name.trim() || track.name;
}

// move a track to a new index among the tracks of its kind
export function reorderTracks(seq: Sequence, trackId: Id, newIndex: number): void {
  const track = trackById(seq, trackId);
  if (!track) return;
  const same = tracksOfKind(seq, track.kind).filter((t) => t.id !== trackId);
  const index = clamp(newIndex, 0, same.length);
  same.splice(index, 0, track);
  const other = tracksOfKind(seq, track.kind === 'video' ? 'audio' : 'video');
  seq.tracks = track.kind === 'video' ? [...same, ...other] : [...other, ...same];
  renumberTracks(seq);
}

export type TransitionAlignment = 'start' | 'center' | 'end';

export interface NewTransition {
  type: string;
  leftClipId: Id | null;
  rightClipId: Id | null;
  duration: number;
  params?: Record<string, Transition['params'][string]>;
  alignment?: TransitionAlignment;
}

interface CutInfo {
  cut: number;
  // the transition may not leave this range
  from: number;
  to: number;
  left: Clip | null;
  right: Clip | null;
}

function cutInfo(track: Track, leftClipId: Id | null, rightClipId: Id | null): CutInfo | null {
  const left = leftClipId ? track.clips.find((c) => c.id === leftClipId) ?? null : null;
  const right = rightClipId ? track.clips.find((c) => c.id === rightClipId) ?? null : null;
  if (leftClipId && !left) return null;
  if (rightClipId && !right) return null;
  if (left && right) {
    if (!nearlyEqual(clipEnd(left), right.start)) return null;
    return { cut: right.start, from: left.start, to: clipEnd(right), left, right };
  }
  if (left) return { cut: clipEnd(left), from: left.start, to: clipEnd(left), left, right: null };
  if (right) return { cut: right.start, from: right.start, to: clipEnd(right), left: null, right };
  return null;
}

function fitTransition(seq: Sequence, info: CutInfo, start: number, duration: number): { start: number; duration: number } {
  const frame = minDuration(seq);
  let d = Math.max(frame, snap(seq, duration));
  let s = snap(seq, start);
  if (!info.left) s = info.cut;
  else if (!info.right) s = info.cut - d;
  // the transition has to contain the cut and stay inside both clips
  d = Math.min(d, snap(seq, info.to - info.from));
  s = clamp(s, Math.max(info.from, info.cut - d), Math.min(info.cut, info.to - d));
  s = snap(seq, s);
  if (s + d > info.to + TOL) d = snap(seq, info.to - s);
  return { start: s, duration: Math.max(frame, d) };
}

function alignedStart(seq: Sequence, cut: number, duration: number, alignment: TransitionAlignment): number {
  if (alignment === 'start') return cut;
  if (alignment === 'end') return cut - duration;
  return snap(seq, cut - duration / 2);
}

// returns the id of the transition, or null when there is no cut to put it on.
// a transition already sitting on that cut is replaced
export function addTransition(seq: Sequence, trackId: Id, transition: NewTransition): Id | null {
  const track = trackById(seq, trackId);
  if (!track || track.locked) return null;
  const info = cutInfo(track, transition.leftClipId, transition.rightClipId);
  if (!info) return null;
  track.transitions = track.transitions.filter(
    (t) => !(t.leftClipId === transition.leftClipId && t.rightClipId === transition.rightClipId)
  );
  const alignment = transition.alignment ?? (info.left && info.right ? 'center' : info.left ? 'end' : 'start');
  const fitted = fitTransition(seq, info, alignedStart(seq, info.cut, transition.duration, alignment), transition.duration);
  const created: Transition = {
    id: id(),
    type: transition.type,
    leftClipId: transition.leftClipId,
    rightClipId: transition.rightClipId,
    start: fitted.start,
    duration: fitted.duration,
    params: transition.params ? { ...transition.params } : {}
  };
  track.transitions.push(created);
  sortTrack(track);
  return created.id;
}

function findTransition(seq: Sequence, transitionId: Id): { transition: Transition; track: Track } | null {
  for (const track of seq.tracks) {
    const transition = track.transitions.find((t) => t.id === transitionId);
    if (transition) return { transition, track };
  }
  return null;
}

export function resizeTransition(seq: Sequence, transitionId: Id, newStart: number, newDuration: number): boolean {
  const found = findTransition(seq, transitionId);
  if (!found || found.track.locked) return false;
  const { transition, track } = found;
  const info = cutInfo(track, transition.leftClipId, transition.rightClipId);
  if (!info) return false;
  const fitted = fitTransition(seq, info, newStart, newDuration);
  transition.start = fitted.start;
  transition.duration = fitted.duration;
  sortTrack(track);
  return true;
}

export function setTransitionAlignment(seq: Sequence, transitionId: Id, alignment: TransitionAlignment): boolean {
  const found = findTransition(seq, transitionId);
  if (!found) return false;
  const info = cutInfo(found.track, found.transition.leftClipId, found.transition.rightClipId);
  if (!info) return false;
  return resizeTransition(seq, transitionId, alignedStart(seq, info.cut, found.transition.duration, alignment), found.transition.duration);
}

export function removeTransition(seq: Sequence, transitionId: Id): void {
  for (const track of seq.tracks) track.transitions = track.transitions.filter((t) => t.id !== transitionId);
}

export function transitionsForClip(seq: Sequence, clipId: Id): Transition[] {
  const out: Transition[] = [];
  for (const track of seq.tracks) {
    for (const t of track.transitions) if (t.leftClipId === clipId || t.rightClipId === clipId) out.push(t);
  }
  return out;
}

// a transition only makes sense while its cut exists. after any edit that
// could have moved, trimmed or removed a clip this drops the orphans and
// shrinks the ones that no longer fit
export function validateTransitions(seq: Sequence): void {
  for (const track of seq.tracks) {
    const keep: Transition[] = [];
    for (const t of track.transitions) {
      const info = cutInfo(track, t.leftClipId, t.rightClipId);
      if (!info) continue;
      const fitted = fitTransition(seq, info, t.start, t.duration);
      t.start = fitted.start;
      t.duration = fitted.duration;
      keep.push(t);
    }
    track.transitions = keep;
    sortTrack(track);
  }
}

export function addMarker(seq: Sequence, marker: Marker): Id {
  seq.markers.push({ ...marker, time: snap(seq, marker.time) });
  seq.markers.sort((a, b) => a.time - b.time);
  return marker.id;
}

export function updateMarker(seq: Sequence, markerId: Id, patch: Partial<Omit<Marker, 'id'>>): void {
  const marker = seq.markers.find((m) => m.id === markerId);
  if (!marker) return;
  Object.assign(marker, patch);
  if (patch.time !== undefined) marker.time = snap(seq, Math.max(0, patch.time));
  seq.markers.sort((a, b) => a.time - b.time);
}

export function removeMarker(seq: Sequence, markerId: Id): void {
  seq.markers = seq.markers.filter((m) => m.id !== markerId);
}

export function setInOut(seq: Sequence, inPoint: number | null, outPoint: number | null): void {
  seq.inPoint = inPoint === null ? null : snap(seq, Math.max(0, inPoint));
  seq.outPoint = outPoint === null ? null : snap(seq, Math.max(0, outPoint));
  if (seq.inPoint !== null && seq.outPoint !== null && seq.outPoint < seq.inPoint) {
    [seq.inPoint, seq.outPoint] = [seq.outPoint, seq.inPoint];
  }
}

export function clearInOut(seq: Sequence): void {
  seq.inPoint = null;
  seq.outPoint = null;
}

function editPoints(seq: Sequence): number[] {
  const points = new Set<number>();
  for (const track of seq.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      points.add(clip.start);
      points.add(clipEnd(clip));
    }
  }
  return [...points].sort((a, b) => a - b);
}

export function nextEdit(seq: Sequence, time: number): number | null {
  return editPoints(seq).find((p) => p > time + TOL) ?? null;
}

export function prevEdit(seq: Sequence, time: number): number | null {
  const before = editPoints(seq).filter((p) => p < time - TOL);
  return before.length ? before[before.length - 1] : null;
}

export function gapsOnTrack(track: Track): { start: number; end: number }[] {
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const clip of track.clips) {
    if (clip.start > cursor + TOL) gaps.push({ start: cursor, end: clip.start });
    cursor = Math.max(cursor, clipEnd(clip));
  }
  return gaps;
}

// ripple delete the empty space under time on a track
export function closeGap(seq: Sequence, trackId: Id, time: number): boolean {
  const track = trackById(seq, trackId);
  if (!track || track.locked) return false;
  const gap = gapsOnTrack(track).find((g) => g.start <= time + TOL && g.end > time + TOL);
  if (!gap) return false;
  ripple(seq, gap.end, gap.start - gap.end, { forceTrackIds: new Set([trackId]) });
  return true;
}
