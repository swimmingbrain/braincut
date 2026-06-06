import { writable } from 'svelte/store';
import type { Clip, Id, Sequence, TrackKind } from '$lib/project/types';
import { id } from '$lib/project/ids';
import { deleteClips, placeClips, type Placement } from '$lib/project/ops';

interface ClipboardEntry {
  clip: Clip;
  trackKind: TrackKind;
  // position among the tracks of that kind, so a paste lands on V2 when the copy came from V2
  trackIndex: number;
  // seconds from the earliest copied clip
  offset: number;
}

// clips only live in this tab: a system clipboard would need a serializer
// for media references that other apps can't use anyway
let entries: ClipboardEntry[] = [];

export const hasClipboard = writable(false);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function trackIndexOfKind(seq: Sequence, trackId: Id): { kind: TrackKind; index: number } | null {
  const track = seq.tracks.find((t) => t.id === trackId);
  if (!track) return null;
  const index = seq.tracks.filter((t) => t.kind === track.kind).indexOf(track);
  return { kind: track.kind, index };
}

export function copyClips(seq: Sequence, clipIds: Id[]): number {
  const wanted = new Set(clipIds);
  const collected: ClipboardEntry[] = [];
  for (const track of seq.tracks) {
    const position = trackIndexOfKind(seq, track.id)!;
    for (const clip of track.clips) {
      if (!wanted.has(clip.id)) continue;
      collected.push({ clip: clone(clip), trackKind: track.kind, trackIndex: position.index, offset: clip.start });
    }
  }
  if (collected.length === 0) return 0;
  const first = Math.min(...collected.map((e) => e.offset));
  for (const e of collected) e.offset -= first;
  entries = collected;
  hasClipboard.set(true);
  return collected.length;
}

export function cutClips(seq: Sequence, clipIds: Id[]): number {
  const count = copyClips(seq, clipIds);
  if (count > 0) deleteClips(seq, clipIds);
  return count;
}

export function clearClipboard(): void {
  entries = [];
  hasClipboard.set(false);
}

export interface PasteOptions {
  // a track the paste should be relative to: the clips shift so the first
  // copied track of that kind lands on it
  trackHint?: Id;
}

// pastes at time on the same track indices they were copied from, in
// overwrite mode. returns the ids of the new clips
export function pasteClips(seq: Sequence, time: number, opts: PasteOptions = {}): Id[] {
  if (entries.length === 0) return [];
  const shift: Record<TrackKind, number> = { video: 0, audio: 0 };
  if (opts.trackHint) {
    const hint = trackIndexOfKind(seq, opts.trackHint);
    if (hint) {
      const lowest = Math.min(...entries.filter((e) => e.trackKind === hint.kind).map((e) => e.trackIndex));
      if (Number.isFinite(lowest)) shift[hint.kind] = hint.index - lowest;
    }
  }
  // fresh ids everywhere, and linked pairs get a fresh shared link id
  const linkIds = new Map<Id, Id>();
  const placements: Placement[] = [];
  for (const entry of entries) {
    const ofKind = seq.tracks.filter((t) => t.kind === entry.trackKind);
    if (ofKind.length === 0) continue;
    const index = Math.min(ofKind.length - 1, Math.max(0, entry.trackIndex + shift[entry.trackKind]));
    const clip = clone(entry.clip);
    clip.id = id();
    clip.start = time + entry.offset;
    if (clip.linkId) {
      const mapped = linkIds.get(clip.linkId) ?? id();
      linkIds.set(clip.linkId, mapped);
      clip.linkId = mapped;
    }
    for (const effect of clip.effects) effect.id = id();
    placements.push({ trackId: ofKind[index].id, clip });
  }
  return placeClips(seq, placements, 'overwrite');
}
