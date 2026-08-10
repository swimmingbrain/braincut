import { get } from 'svelte/store';
import { createClipFromMedia } from '$lib/project/defaults';
import { placeClips, type Placement } from '$lib/project/ops';
import { activeSequence, editSequence, mediaById } from '$lib/project/store';
import type { MediaItem } from '$lib/project/types';
import { addToast, playhead, sourceMedia } from '$lib/stores/app';
import { preferences } from '$lib/stores/preferences';

// the length of a file as the source monitor sees it: stills have none of
// their own and show for the preference duration
export function sourceDuration(media: MediaItem): number {
  return media.kind === 'image' ? get(preferences).stillImageDuration : media.duration;
}

// the marked range, or the whole file when nothing is marked
export function sourceRange(media: MediaItem): { in: number; out: number } {
  const v = get(sourceMedia);
  const inPoint = v?.in ?? 0;
  const out = v && v.out > inPoint ? v.out : sourceDuration(media);
  return { in: inPoint, out };
}

// the source range lands on the first unlocked video and audio tracks at
// the playhead, the way a desktop editor does it with its default patching
function place(mode: 'insert' | 'overwrite'): boolean {
  const value = get(sourceMedia);
  const media = value ? get(mediaById).get(value.mediaId) : undefined;
  const seq = get(activeSequence);
  if (!media || !seq) {
    addToast('Open a clip in the source monitor first', 'info');
    return false;
  }
  if (media.status !== 'ready') {
    addToast(`${media.name} is ${media.status === 'missing' ? 'missing' : 'not usable yet'}`, 'warning');
    return false;
  }
  const { in: inPoint, out } = sourceRange(media);
  const clips = createClipFromMedia(media, get(playhead), {
    in: inPoint,
    duration: Math.max(1 / seq.fps, out - inPoint),
    fps: seq.fps,
    stillDuration: get(preferences).stillImageDuration
  });
  const video = seq.tracks.find((t) => t.kind === 'video' && !t.locked);
  const audio = seq.tracks.find((t) => t.kind === 'audio' && !t.locked);
  const placements: Placement[] = [];
  if (clips.video && video) placements.push({ trackId: video.id, clip: clips.video });
  if (clips.audio && audio) placements.push({ trackId: audio.id, clip: clips.audio });
  if (placements.length === 0) {
    addToast('No unlocked track to place the clip on', 'warning');
    return false;
  }
  editSequence(mode === 'insert' ? 'insert clip' : 'overwrite clip', (draft) => {
    placeClips(draft, placements, mode);
  });
  return true;
}

export function insertSource(): boolean {
  return place('insert');
}

export function overwriteSource(): boolean {
  return place('overwrite');
}
