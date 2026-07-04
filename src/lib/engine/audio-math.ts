import type { Clip, Track } from '$lib/project/types';
import { clipSourceRange, sequenceTimeOfSource } from './clip-time';

// the arithmetic behind audio scheduling, kept free of web audio so it can
// be tested in node

export const SILENCE_DB = -60;

export function dbToGain(db: number): number {
  if (!Number.isFinite(db) || db <= SILENCE_DB) return 0;
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  if (gain <= 0) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(gain));
}

export interface Placement {
  // sequence time where the piece starts playing
  seqStart: number;
  seqDuration: number;
  // seconds into the buffer to start from and how many to play
  offset: number;
  duration: number;
}

// where a decoded piece of audio lands on the sequence. the piece covers
// source seconds [chunkStart, chunkStart + chunkDuration); for a reversed
// clip the buffer has already been flipped, so its first sample is the
// latest source time
export function chunkPlacement(clip: Clip, chunkStart: number, chunkDuration: number): Placement | null {
  if (chunkDuration <= 0 || clip.speed <= 0) return null;
  const range = clipSourceRange(clip);
  const os = Math.max(chunkStart, range.start);
  const oe = Math.min(chunkStart + chunkDuration, range.end);
  if (oe - os <= 1e-9) return null;
  const play = oe - os;
  if (clip.reverse) {
    return {
      seqStart: sequenceTimeOfSource(clip, oe),
      seqDuration: play / clip.speed,
      offset: chunkStart + chunkDuration - oe,
      duration: play
    };
  }
  return {
    seqStart: sequenceTimeOfSource(clip, os),
    seqDuration: play / clip.speed,
    offset: os - chunkStart,
    duration: play
  };
}

// the latest sequence time a piece reaches, used to know how far ahead the
// scheduler got even when the piece fell outside the clip
export function chunkSequenceEnd(clip: Clip, chunkStart: number, chunkDuration: number): number {
  return clip.reverse
    ? sequenceTimeOfSource(clip, chunkStart)
    : sequenceTimeOfSource(clip, chunkStart + chunkDuration);
}

// a piece scheduled for a moment that already passed starts now, further
// into its buffer, instead of playing late
export function catchUp(
  p: Placement,
  ctxStart: number,
  ctxNow: number,
  playbackRate: number
): { when: number; offset: number; duration: number } | null {
  if (ctxStart >= ctxNow) return { when: ctxStart, offset: p.offset, duration: p.duration };
  const late = (ctxNow - ctxStart) * playbackRate;
  if (late >= p.duration) return null;
  return { when: ctxNow, offset: p.offset + late, duration: p.duration - late };
}

// sequence times at which automated values are sampled across a piece
export function automationTimes(seqStart: number, seqDuration: number, step: number): number[] {
  const times = [seqStart];
  if (step <= 0) return times;
  // multiplied, not accumulated, so the times don't drift along a long piece
  for (let i = 1; seqStart + i * step < seqStart + seqDuration - 1e-9; i++) times.push(seqStart + i * step);
  return times;
}

export interface Curve {
  outGain: number;
  inGain: number;
}

// gain the audio transitions on a track apply to one of its clips at t
export function transitionGainAt(track: Track, clip: Clip, t: number, curve: (type: string, progress: number) => Curve): number {
  let gain = 1;
  for (const tr of track.transitions) {
    if (t < tr.start || t >= tr.start + tr.duration) continue;
    const progress = tr.duration > 0 ? (t - tr.start) / tr.duration : 1;
    if (tr.leftClipId === clip.id) gain *= curve(tr.type, progress).outGain;
    else if (tr.rightClipId === clip.id) gain *= curve(tr.type, progress).inGain;
  }
  return gain;
}

// the piece of the source a clip needs between two sequence times, ordered
// the way the file is read
export function sourceWindow(clip: Clip, seqFrom: number, seqTo: number, mediaDuration: number): { start: number; end: number } {
  const range = clipSourceRange(clip);
  const a = Math.max(seqFrom, clip.start);
  const b = Math.min(seqTo, clip.start + clip.duration);
  if (b <= a) return { start: 0, end: 0 };
  const limit = mediaDuration > 0 ? mediaDuration : Infinity;
  const clampSrc = (s: number) => Math.min(limit, Math.max(0, s));
  let start: number;
  let end: number;
  if (clip.reverse) {
    start = range.end - (b - clip.start) * clip.speed;
    end = range.end - (a - clip.start) * clip.speed;
  } else {
    start = range.start + (a - clip.start) * clip.speed;
    end = range.start + (b - clip.start) * clip.speed;
  }
  return { start: clampSrc(start), end: clampSrc(end) };
}
