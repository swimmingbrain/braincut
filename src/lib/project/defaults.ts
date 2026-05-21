import { id } from './ids';
import type { Clip, ClipKind, EffectInstance, Marker, MediaItem, Project, Sequence, Track, TrackKind, TitleData } from './types';
import { snapToFrame } from './time';

export const VIDEO_TRACK_HEIGHT = 56;
export const AUDIO_TRACK_HEIGHT = 40;

export function createProject(name: string): Project {
  const now = Date.now();
  return {
    id: id(),
    name,
    version: 1,
    createdAt: now,
    modifiedAt: now,
    media: [],
    bins: [],
    sequences: [],
    activeSequenceId: null
  };
}

export function createTrack(kind: TrackKind, index: number): Track {
  return {
    id: id(),
    kind,
    name: `${kind === 'video' ? 'V' : 'A'}${index + 1}`,
    clips: [],
    transitions: [],
    muted: false,
    solo: false,
    locked: false,
    hidden: false,
    volume: 0,
    height: kind === 'video' ? VIDEO_TRACK_HEIGHT : AUDIO_TRACK_HEIGHT
  };
}

export interface SequenceSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  sampleRate?: number;
  videoTracks?: number;
  audioTracks?: number;
}

export function createSequence(settings: SequenceSettings): Sequence {
  const tracks: Track[] = [];
  for (let i = 0; i < (settings.videoTracks ?? 3); i++) tracks.push(createTrack('video', i));
  for (let i = 0; i < (settings.audioTracks ?? 3); i++) tracks.push(createTrack('audio', i));
  return {
    id: id(),
    name: settings.name,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    sampleRate: settings.sampleRate ?? 48000,
    tracks,
    markers: [],
    inPoint: null,
    outPoint: null
  };
}

function fixed(type: string, params: EffectInstance['params']): EffectInstance {
  return { id: id(), type, enabled: true, fixed: true, params, keyframes: {} };
}

// the effects every clip carries and nobody can remove
export function fixedEffects(kind: ClipKind): EffectInstance[] {
  if (kind === 'audio') {
    return [fixed('volume', { level: 0 }), fixed('pan', { pan: 0 })];
  }
  return [
    fixed('transform', {
      position: [0, 0],
      scale: 100,
      scaleY: 100,
      uniformScale: true,
      rotation: 0,
      anchor: [0, 0],
      flipH: false,
      flipV: false
    }),
    fixed('opacity', { opacity: 100, blendMode: 'normal' })
  ];
}

function baseClip(kind: ClipKind, name: string, start: number, duration: number): Clip {
  return {
    id: id(),
    kind,
    name,
    mediaId: null,
    start,
    duration,
    in: 0,
    speed: 1,
    reverse: false,
    linkId: null,
    enabled: true,
    label: 'none',
    effects: fixedEffects(kind)
  };
}

export interface ClipFromMediaOptions {
  in?: number;
  duration?: number;
  kind?: 'video' | 'audio';
  // seconds an image stays on screen
  stillDuration?: number;
  // sequence frame rate the durations are snapped to
  fps?: number;
}

// a video file with sound becomes two clips that share a link id, so they
// move and delete together like in every desktop editor
export function createClipFromMedia(
  media: MediaItem,
  start: number,
  opts: ClipFromMediaOptions = {}
): { video?: Clip; audio?: Clip } {
  const fps = opts.fps ?? 30;
  const inPoint = Math.max(0, opts.in ?? 0);
  const isStill = media.kind === 'image';
  const available = isStill ? Infinity : Math.max(0, media.duration - inPoint);
  const wanted = opts.duration ?? (isStill ? (opts.stillDuration ?? 5) : available);
  const duration = snapToFrame(Math.max(1 / fps, Math.min(wanted, available)), fps);
  const wantVideo = opts.kind !== 'audio' && (media.hasVideo || isStill);
  const wantAudio = opts.kind !== 'video' && media.hasAudio;
  const linkId = wantVideo && wantAudio ? id() : null;
  const result: { video?: Clip; audio?: Clip } = {};

  if (wantVideo) {
    const clip = baseClip(isStill ? 'image' : 'video', media.name, start, duration);
    clip.mediaId = media.id;
    clip.in = isStill ? 0 : inPoint;
    clip.linkId = linkId;
    clip.label = media.label;
    result.video = clip;
  }
  if (wantAudio) {
    const clip = baseClip('audio', media.name, start, duration);
    clip.mediaId = media.id;
    clip.in = inPoint;
    clip.linkId = linkId;
    clip.label = media.label;
    result.audio = clip;
  }
  return result;
}

export function defaultTitle(): TitleData {
  return {
    text: 'Title',
    fontFamily: 'Inter',
    fontSize: 72,
    fontWeight: 600,
    italic: false,
    color: '#ffffff',
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    stroke: null,
    shadow: null,
    background: null,
    box: { x: 0.1, y: 0.4, width: 0.8 }
  };
}

export function createTitleClip(start: number, duration: number, text?: string): Clip {
  const title = defaultTitle();
  if (text !== undefined) title.text = text;
  const clip = baseClip('title', title.text || 'Title', start, duration);
  clip.title = title;
  return clip;
}

export function createColorClip(start: number, duration: number, color: string): Clip {
  const clip = baseClip('color', 'Color Matte', start, duration);
  clip.color = color;
  return clip;
}

export function createAdjustmentClip(start: number, duration: number): Clip {
  return baseClip('adjustment', 'Adjustment Layer', start, duration);
}

export function createMarker(time: number, opts: Partial<Omit<Marker, 'id' | 'time'>> = {}): Marker {
  return {
    id: id(),
    time,
    duration: opts.duration ?? 0,
    name: opts.name ?? '',
    color: opts.color ?? 'green',
    note: opts.note ?? ''
  };
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function sequenceDuration(seq: Sequence): number {
  let end = 0;
  for (const track of seq.tracks) {
    for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  }
  return end;
}
