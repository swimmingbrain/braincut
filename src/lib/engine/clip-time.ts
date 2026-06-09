import type { Clip } from '$lib/project/types';

// where a clip reads its media at sequence time t. beyond the media the
// last frame freezes, the compositor and the audio engine both rely on that
export function sourceTimeAt(clip: Clip, t: number, mediaDuration: number): number {
  const elapsed = (t - clip.start) * clip.speed;
  const raw = clip.reverse ? clip.in + clip.duration * clip.speed - elapsed : clip.in + elapsed;
  if (mediaDuration > 0) return Math.min(mediaDuration, Math.max(0, raw));
  return Math.max(0, raw);
}

// the source range a clip covers, regardless of direction
export function clipSourceRange(clip: Clip): { start: number; end: number } {
  return { start: clip.in, end: clip.in + clip.duration * clip.speed };
}

// inverse of sourceTimeAt for the forward direction, used to place decoded
// audio chunks on the sequence
export function sequenceTimeOfSource(clip: Clip, source: number): number {
  if (clip.reverse) return clip.start + (clip.in + clip.duration * clip.speed - source) / clip.speed;
  return clip.start + (source - clip.in) / clip.speed;
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}
