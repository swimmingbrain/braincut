import type { Bin, Clip, EffectInstance, Keyframe, Label, Marker, MediaItem, ParamValue, Project, Sequence, TitleData, Track, Transition } from './types';
import { defaultTitle, fixedEffects } from './defaults';
import { id } from './ids';

export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = '.braincut';

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

export function projectFileName(p: Project): string {
  const safe = p.name.trim().replace(/[\\/:*?"<>|]+/g, '-') || 'untitled';
  return safe.endsWith(PROJECT_EXTENSION) ? safe : safe + PROJECT_EXTENSION;
}

class ShapeError extends Error {
  constructor(path: string, expected: string) {
    super(`Not a brainCUT project: ${path} should be ${expected}`);
  }
}

type Raw = Record<string, unknown>;

function isRecord(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(raw: Raw, key: string, path: string, fallback?: string): string {
  const v = raw[key];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new ShapeError(`${path}.${key}`, 'a string');
}

function num(raw: Raw, key: string, path: string, fallback?: number): number {
  const v = raw[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new ShapeError(`${path}.${key}`, 'a number');
}

function bool(raw: Raw, key: string, fallback: boolean): boolean {
  const v = raw[key];
  return typeof v === 'boolean' ? v : fallback;
}

function strOrNull(raw: Raw, key: string): string | null {
  const v = raw[key];
  return typeof v === 'string' ? v : null;
}

function list(raw: Raw, key: string, path: string, required: boolean): unknown[] {
  const v = raw[key];
  if (Array.isArray(v)) return v;
  if (!required) return [];
  throw new ShapeError(`${path}.${key}`, 'a list');
}

function record(raw: Raw, key: string, path: string, required = true): Raw {
  const v = raw[key];
  if (isRecord(v)) return v;
  if (!required) return {};
  throw new ShapeError(`${path}.${key}`, 'an object');
}

const labels: Label[] = ['none', 'violet', 'iris', 'caribbean', 'lavender', 'cerulean', 'forest', 'rose', 'mango', 'purple', 'blue', 'teal', 'magenta', 'tan', 'green', 'brown', 'yellow'];

function label(raw: Raw, fallback: Label = 'none'): Label {
  const v = raw.label ?? raw.color;
  return typeof v === 'string' && (labels as string[]).includes(v) ? (v as Label) : fallback;
}

function paramValue(v: unknown): ParamValue | null {
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return [v[0], v[1]];
  return null;
}

function params(raw: unknown): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const value = paramValue(v);
    if (value !== null) out[k] = value;
  }
  return out;
}

const easings = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'] as const;

function keyframes(raw: unknown): Record<string, Keyframe[]> {
  const out: Record<string, Keyframe[]> = {};
  if (!isRecord(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!Array.isArray(v)) continue;
    const frames: Keyframe[] = [];
    for (const item of v) {
      if (!isRecord(item)) continue;
      const value = paramValue(item.value);
      const time = item.time;
      if (value === null || typeof time !== 'number') continue;
      const easing = (easings as readonly string[]).includes(String(item.easing)) ? (item.easing as Keyframe['easing']) : 'linear';
      frames.push({ time, value, easing });
    }
    frames.sort((a, b) => a.time - b.time);
    if (frames.length) out[k] = frames;
  }
  return out;
}

function effect(raw: unknown, path: string): EffectInstance {
  if (!isRecord(raw)) throw new ShapeError(path, 'an effect');
  const e: EffectInstance = {
    id: str(raw, 'id', path, id()),
    type: str(raw, 'type', path),
    enabled: bool(raw, 'enabled', true),
    params: params(raw.params),
    keyframes: keyframes(raw.keyframes)
  };
  if (raw.fixed === true) e.fixed = true;
  return e;
}

function title(raw: unknown): TitleData {
  const base = defaultTitle();
  if (!isRecord(raw)) return base;
  const t: TitleData = {
    ...base,
    text: str(raw, 'text', 'title', base.text),
    fontFamily: str(raw, 'fontFamily', 'title', base.fontFamily),
    fontSize: num(raw, 'fontSize', 'title', base.fontSize),
    italic: bool(raw, 'italic', false),
    color: str(raw, 'color', 'title', base.color),
    lineHeight: num(raw, 'lineHeight', 'title', base.lineHeight),
    letterSpacing: num(raw, 'letterSpacing', 'title', base.letterSpacing)
  };
  const weight = raw.fontWeight;
  if (weight === 400 || weight === 500 || weight === 600 || weight === 700) t.fontWeight = weight;
  const align = raw.align;
  if (align === 'left' || align === 'center' || align === 'right') t.align = align;
  if (isRecord(raw.stroke)) t.stroke = { color: str(raw.stroke, 'color', 'title.stroke', '#000000'), width: num(raw.stroke, 'width', 'title.stroke', 0) };
  if (isRecord(raw.shadow)) {
    t.shadow = {
      color: str(raw.shadow, 'color', 'title.shadow', '#000000'),
      blur: num(raw.shadow, 'blur', 'title.shadow', 0),
      x: num(raw.shadow, 'x', 'title.shadow', 0),
      y: num(raw.shadow, 'y', 'title.shadow', 0)
    };
  }
  if (isRecord(raw.background)) t.background = { color: str(raw.background, 'color', 'title.background', '#000000'), padding: num(raw.background, 'padding', 'title.background', 0) };
  if (isRecord(raw.box)) t.box = { x: num(raw.box, 'x', 'title.box', base.box.x), y: num(raw.box, 'y', 'title.box', base.box.y), width: num(raw.box, 'width', 'title.box', base.box.width) };
  return t;
}

const clipKinds = ['video', 'audio', 'image', 'title', 'color', 'adjustment'] as const;

function clip(raw: unknown, path: string): Clip {
  if (!isRecord(raw)) throw new ShapeError(path, 'a clip');
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(clipKinds as readonly string[]).includes(kind)) throw new ShapeError(`${path}.kind`, 'a clip kind');
  const c: Clip = {
    id: str(raw, 'id', path, id()),
    kind: kind as Clip['kind'],
    name: str(raw, 'name', path, ''),
    mediaId: strOrNull(raw, 'mediaId'),
    start: num(raw, 'start', path),
    duration: num(raw, 'duration', path),
    in: num(raw, 'in', path, 0),
    speed: Math.max(1e-3, num(raw, 'speed', path, 1)),
    reverse: bool(raw, 'reverse', false),
    linkId: strOrNull(raw, 'linkId'),
    enabled: bool(raw, 'enabled', true),
    label: label(raw),
    effects: list(raw, 'effects', path, false).map((e, i) => effect(e, `${path}.effects[${i}]`))
  };
  // a file from a build that stored fewer fixed effects still gets them all
  const missing = fixedEffects(c.kind).filter((fixed) => !c.effects.some((e) => e.type === fixed.type && e.fixed));
  c.effects.unshift(...missing);
  if (c.kind === 'title') c.title = title(raw.title);
  if (c.kind === 'color') c.color = str(raw, 'color', path, '#000000');
  return c;
}

function transition(raw: unknown, path: string): Transition {
  if (!isRecord(raw)) throw new ShapeError(path, 'a transition');
  return {
    id: str(raw, 'id', path, id()),
    type: str(raw, 'type', path),
    leftClipId: strOrNull(raw, 'leftClipId'),
    rightClipId: strOrNull(raw, 'rightClipId'),
    start: num(raw, 'start', path),
    duration: num(raw, 'duration', path),
    params: params(raw.params)
  };
}

function track(raw: unknown, path: string): Track {
  if (!isRecord(raw)) throw new ShapeError(path, 'a track');
  const kind = raw.kind === 'audio' ? 'audio' : raw.kind === 'video' ? 'video' : null;
  if (!kind) throw new ShapeError(`${path}.kind`, 'video or audio');
  const t: Track = {
    id: str(raw, 'id', path, id()),
    kind,
    name: str(raw, 'name', path, kind === 'video' ? 'V' : 'A'),
    clips: list(raw, 'clips', path, false).map((c, i) => clip(c, `${path}.clips[${i}]`)),
    transitions: list(raw, 'transitions', path, false).map((c, i) => transition(c, `${path}.transitions[${i}]`)),
    muted: bool(raw, 'muted', false),
    solo: bool(raw, 'solo', false),
    locked: bool(raw, 'locked', false),
    hidden: bool(raw, 'hidden', false),
    volume: num(raw, 'volume', path, 0),
    height: num(raw, 'height', path, kind === 'video' ? 56 : 40)
  };
  t.clips.sort((a, b) => a.start - b.start);
  t.transitions.sort((a, b) => a.start - b.start);
  return t;
}

function marker(raw: unknown, path: string): Marker {
  if (!isRecord(raw)) throw new ShapeError(path, 'a marker');
  return {
    id: str(raw, 'id', path, id()),
    time: num(raw, 'time', path),
    duration: num(raw, 'duration', path, 0),
    name: str(raw, 'name', path, ''),
    color: label(raw, 'green'),
    note: str(raw, 'note', path, '')
  };
}

function sequence(raw: unknown, path: string): Sequence {
  if (!isRecord(raw)) throw new ShapeError(path, 'a sequence');
  const tracks = list(raw, 'tracks', path, true).map((t, i) => track(t, `${path}.tracks[${i}]`));
  const inPoint = raw.inPoint;
  const outPoint = raw.outPoint;
  return {
    id: str(raw, 'id', path, id()),
    name: str(raw, 'name', path, 'Sequence'),
    width: num(raw, 'width', path),
    height: num(raw, 'height', path),
    fps: num(raw, 'fps', path),
    sampleRate: num(raw, 'sampleRate', path, 48000),
    // video tracks first, whatever order the file had
    tracks: [...tracks.filter((t) => t.kind === 'video'), ...tracks.filter((t) => t.kind === 'audio')],
    markers: list(raw, 'markers', path, false).map((m, i) => marker(m, `${path}.markers[${i}]`)),
    inPoint: typeof inPoint === 'number' ? inPoint : null,
    outPoint: typeof outPoint === 'number' ? outPoint : null
  };
}

const rotations = [0, 90, 180, 270] as const;
const statuses = ['ready', 'missing', 'unsupported', 'converting'] as const;

function media(raw: unknown, path: string): MediaItem {
  if (!isRecord(raw)) throw new ShapeError(path, 'a media item');
  const kind = raw.kind;
  if (kind !== 'video' && kind !== 'audio' && kind !== 'image') throw new ShapeError(`${path}.kind`, 'a media kind');
  const rotation = raw.rotation;
  const status = raw.status;
  const proxy = raw.proxy;
  const converted = raw.converted;
  const m: MediaItem = {
    id: str(raw, 'id', path),
    name: str(raw, 'name', path),
    kind,
    binId: strOrNull(raw, 'binId'),
    duration: num(raw, 'duration', path, 0),
    width: num(raw, 'width', path, 0),
    height: num(raw, 'height', path, 0),
    fps: typeof raw.fps === 'number' ? raw.fps : null,
    hasVideo: bool(raw, 'hasVideo', kind !== 'audio'),
    hasAudio: bool(raw, 'hasAudio', kind !== 'image'),
    channels: num(raw, 'channels', path, 0),
    sampleRate: num(raw, 'sampleRate', path, 0),
    videoCodec: strOrNull(raw, 'videoCodec'),
    audioCodec: strOrNull(raw, 'audioCodec'),
    container: strOrNull(raw, 'container'),
    mimeType: str(raw, 'mimeType', path, ''),
    fileSize: num(raw, 'fileSize', path, 0),
    rotation: (rotations as readonly unknown[]).includes(rotation) ? (rotation as MediaItem['rotation']) : 0,
    alpha: bool(raw, 'alpha', false),
    // whatever the file says, the blob has to be found again after opening
    status: (statuses as readonly unknown[]).includes(status) && status !== 'converting' ? (status as MediaItem['status']) : 'missing',
    proxy: isRecord(proxy) && typeof proxy.key === 'string' ? { key: proxy.key, width: num(proxy, 'width', `${path}.proxy`, 0), height: num(proxy, 'height', `${path}.proxy`, 0) } : null,
    converted: isRecord(converted) && typeof converted.key === 'string' ? { key: converted.key } : null,
    thumbnail: strOrNull(raw, 'thumbnail'),
    label: label(raw),
    addedAt: num(raw, 'addedAt', path, 0)
  };
  if (typeof raw.statusReason === 'string') m.statusReason = raw.statusReason;
  return m;
}

function bin(raw: unknown, path: string): Bin {
  if (!isRecord(raw)) throw new ShapeError(path, 'a bin');
  return { id: str(raw, 'id', path), name: str(raw, 'name', path, 'Bin'), parentId: strOrNull(raw, 'parentId') };
}

// older files get rewritten to the current shape here, one step per version
function migrate(raw: Raw): Raw {
  const version = typeof raw.version === 'number' ? raw.version : 1;
  if (version > PROJECT_VERSION) {
    throw new Error(`This project was saved by a newer brainCUT (file version ${version}). Update to open it.`);
  }
  return raw;
}

export function parseProject(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a brainCUT project: the file is not valid JSON');
  }
  if (!isRecord(raw)) throw new ShapeError('project', 'an object');
  if (!Array.isArray(raw.sequences)) throw new ShapeError('project.sequences', 'a list');
  return fromRaw(migrate(raw));
}

// the same validation for data that never went through JSON, like an
// autosave record from indexeddb
export function normalizeProject(value: unknown): Project {
  if (!isRecord(value)) throw new ShapeError('project', 'an object');
  return fromRaw(migrate(value));
}

function fromRaw(raw: Raw): Project {
  const now = Date.now();
  const sequences = list(raw, 'sequences', 'project', true).map((s, i) => sequence(s, `project.sequences[${i}]`));
  const activeSequenceId = strOrNull(raw, 'activeSequenceId');
  return {
    id: str(raw, 'id', 'project', id()),
    name: str(raw, 'name', 'project', 'Untitled'),
    version: 1,
    createdAt: num(raw, 'createdAt', 'project', now),
    modifiedAt: num(raw, 'modifiedAt', 'project', now),
    media: list(raw, 'media', 'project', false).map((m, i) => media(m, `project.media[${i}]`)),
    bins: list(raw, 'bins', 'project', false).map((b, i) => bin(b, `project.bins[${i}]`)),
    sequences,
    activeSequenceId: activeSequenceId && sequences.some((s) => s.id === activeSequenceId) ? activeSequenceId : (sequences[0]?.id ?? null)
  };
}
