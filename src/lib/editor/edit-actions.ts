import { get } from 'svelte/store';
import { tick } from 'svelte';
import type { Clip, Id, Sequence } from '$lib/project/types';
import { activeSequence, editSequence, mediaById, selectedClips } from '$lib/project/store';
import * as ops from '$lib/project/ops';
import { clipEnd, createAdjustmentClip, createColorClip, createTitleClip } from '$lib/project/defaults';
import { isAnimated, setKeyframe } from '$lib/project/keyframes';
import { fitScale } from '$lib/engine/transform';
import { program } from '$lib/engine/session';
import {
  addToast,
  bottomPanelTab,
  dialog,
  followPlayhead,
  leftPanelTab,
  loopPlayback,
  playhead,
  previewQuality,
  selection,
  snapEnabled
} from '$lib/stores/app';
import { preferences } from '$lib/stores/preferences';

// the actions the shortcuts and the command palette share that don't belong
// to the timeline module: marks, ripple trims, generated clips, the player

function seq(): Sequence | null {
  return get(activeSequence);
}

export function markIn(): void {
  const t = get(playhead);
  editSequence('mark in', (s) => ops.setInOut(s, t, s.outPoint));
}

export function markOut(): void {
  const t = get(playhead);
  editSequence('mark out', (s) => ops.setInOut(s, s.inPoint, t));
}

export function clearInOut(): void {
  editSequence('clear in/out', (s) => ops.clearInOut(s));
}

export function goToIn(): void {
  const s = seq();
  if (s?.inPoint !== null && s?.inPoint !== undefined) program().player.seek(s.inPoint);
}

export function goToOut(): void {
  const s = seq();
  if (s?.outPoint !== null && s?.outPoint !== undefined) program().player.seek(s.outPoint);
}

// the clips under the playhead on the tracks that matter: those of the
// selection when there is one, every unlocked track otherwise
function clipsUnderPlayhead(s: Sequence, time: number): { trackId: Id; clip: Clip }[] {
  const selected = new Set(get(selection));
  const wanted = new Set<Id>();
  if (selected.size) {
    for (const track of s.tracks) if (track.clips.some((c) => selected.has(c.id))) wanted.add(track.id);
  }
  const out: { trackId: Id; clip: Clip }[] = [];
  for (const track of s.tracks) {
    if (track.locked) continue;
    if (wanted.size && !wanted.has(track.id)) continue;
    const clip = ops.clipAt(track, time);
    if (clip) out.push({ trackId: track.id, clip });
  }
  return out;
}

// q and w: the part of the clip between the nearest edit and the playhead
// goes away and what follows closes the gap, like a razor plus ripple delete
export function rippleTrimToPlayhead(edge: 'previous' | 'next'): void {
  const s = seq();
  if (!s) return;
  const time = get(playhead);
  const under = clipsUnderPlayhead(s, time);
  if (under.length === 0) {
    addToast('No clip under the playhead', 'info');
    return;
  }
  const trackIds = under.map((u) => u.trackId);
  const from = edge === 'previous' ? Math.max(...under.map((u) => u.clip.start)) : time;
  const to = edge === 'previous' ? time : Math.min(...under.map((u) => clipEnd(u.clip)));
  if (to - from < 1 / s.fps / 2) return;
  editSequence(edge === 'previous' ? 'ripple trim previous edit' : 'ripple trim next edit', (d) =>
    ops.extractRange(d, from, to, trackIds)
  );
}

const SILENCE = -60;

// there is no mute flag on a clip, the volume level is the honest thing to
// touch. muted clips go back to unity when toggled again
export function toggleMuteSelection(): void {
  const clips = selectedClips().filter((c) => c.kind === 'audio');
  if (clips.length === 0) {
    addToast('Select an audio clip first', 'info');
    return;
  }
  const level = (c: Clip) => c.effects.find((e) => e.type === 'volume')?.params.level;
  const muted = clips.every((c) => level(c) === SILENCE);
  const ids = clips.map((c) => c.id);
  editSequence(muted ? 'unmute clips' : 'mute clips', (d) => {
    for (const cid of ids) {
      const found = ops.findClipById(d, cid);
      const volume = found?.clip.effects.find((e) => e.type === 'volume');
      if (!volume || found?.track.locked) continue;
      volume.params.level = muted ? 0 : SILENCE;
      delete volume.keyframes.level;
    }
  });
}

// titles, mattes and adjustment layers land on the topmost unlocked video
// track so they sit above the footage
export function addGeneratedClip(kind: 'title' | 'color' | 'adjustment'): void {
  const s = seq();
  if (!s) return;
  const track = [...s.tracks].reverse().find((t) => t.kind === 'video' && !t.locked);
  if (!track) {
    addToast('No unlocked video track to put it on', 'warning');
    return;
  }
  const duration = get(preferences).stillImageDuration;
  const at = get(playhead);
  const clip =
    kind === 'title' ? createTitleClip(at, duration) : kind === 'color' ? createColorClip(at, duration, '#000000') : createAdjustmentClip(at, duration);
  editSequence(`add ${clip.name.toLowerCase()}`, (d) => {
    ops.overwriteClip(d, track.id, clip, at);
  });
  selection.set([clip.id]);
  if (kind === 'title') dialog.set({ kind: 'title', clipId: clip.id });
}

// the selected picture clips scaled so the whole frame shows, position reset
export function setToFrameSize(): void {
  const s = seq();
  if (!s) return;
  const media = get(mediaById);
  const time = get(playhead);
  const clips = selectedClips().filter((c) => c.kind !== 'audio');
  if (clips.length === 0) {
    addToast('Select a video clip first', 'info');
    return;
  }
  editSequence('set to frame size', (d) => {
    for (const c of clips) {
      const found = ops.findClipById(d, c.id);
      if (!found || found.track.locked) continue;
      const item = found.clip.mediaId ? media.get(found.clip.mediaId) : undefined;
      const size = item && item.width > 0 ? item : { width: d.width, height: d.height };
      const scale = Math.round(fitScale(size, d) * 100) / 100;
      const transform = found.clip.effects.find((e) => e.type === 'transform');
      if (!transform) continue;
      const clipTime = Math.max(0, Math.min(found.clip.duration, time - found.clip.start));
      for (const key of ['scale', 'scaleY']) {
        if (isAnimated(transform, key)) setKeyframe(transform, key, clipTime, scale);
        else transform.params[key] = scale;
      }
      transform.params.position = [0, 0];
    }
  });
}

export function openSpeedDialog(): void {
  const ids = get(selection);
  if (ids.length === 0) {
    addToast('Select a clip first', 'info');
    return;
  }
  dialog.set({ kind: 'speed', clipIds: ids });
}

export function toggleSnapping(): void {
  snapEnabled.update((on) => !on);
}

export function toggleFollowPlayhead(): void {
  followPlayhead.update((on) => !on);
}

export function toggleLoop(): void {
  loopPlayback.update((on) => !on);
}

export function setPreviewQuality(q: 1 | 0.5 | 0.25): void {
  previewQuality.set(q);
}

export type PanelName = 'project' | 'source' | 'program' | 'timeline' | 'effects';

// shift+1..5: show the tab and hand it the keyboard. panels mark themselves
// with data-panel, the first focusable thing inside takes the focus
export async function focusPanel(name: PanelName): Promise<void> {
  if (name === 'project') bottomPanelTab.set('project');
  else if (name === 'effects') bottomPanelTab.set('effects');
  else if (name === 'source') leftPanelTab.set('source');
  await tick();
  const root = document.querySelector<HTMLElement>(`[data-panel="${name}"]`);
  if (!root) return;
  const target = root.querySelector<HTMLElement>('[tabindex="0"], input, button') ?? root;
  target.focus({ preventScroll: true });
}
