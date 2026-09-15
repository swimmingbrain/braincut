// the tools claude code can run in this tab. each one is a thin layer over the
// same ops the ui uses, so an edit made from here is one undo step like any
// other and shows up in the timeline as it happens.
//
// this module stays importable in node for the tests: everything that needs a
// browser (the player, the importer, the exporter, pixi) is imported lazily

import { get } from 'svelte/store';
import type {
  Clip,
  Easing,
  EffectInstance,
  Id,
  Label,
  MediaItem,
  ParamValue,
  Project,
  Sequence,
  Track,
  TrackKind
} from '$lib/project/types';
import {
  activeSequence,
  clearSelection,
  dirty,
  edit,
  findClip,
  history,
  loadProject,
  markSaved,
  mediaById,
  project,
  redo,
  selectClips,
  setActiveSequence,
  undo
} from '$lib/project/store';
import * as ops from '$lib/project/ops';
import {
  clipEnd,
  createClipFromMedia,
  createMarker,
  createProject,
  createSequence,
  createTitleClip,
  sequenceDuration
} from '$lib/project/defaults';
import { formatTimecode, nearlyEqual, snapToFrame } from '$lib/project/time';
import { setKeyframe, valueAt } from '$lib/project/keyframes';
import { projectFileName, serializeProject } from '$lib/project/serialize';
import { setLastOpenedId, touchRecent } from '$lib/project/persistence';
import { id as newId } from '$lib/project/ids';
import {
  createEffectInstance,
  effectDef,
  effectDefs,
  paramDef,
  type ParamDef
} from '$lib/engine/effects/registry';
import { isAudioTransitionType, transitionDef, transitionDefs } from '$lib/engine/transitions/registry';
import { presetById, presets as sequencePresets } from '$lib/templates/sequences';
import { addToast, exportJob, playhead, playing, renderStatus, selectedTransitionId, selection } from '$lib/stores/app';
import { preferences } from '$lib/stores/preferences';
import { version } from '$lib/version';
import type { ImportEntry } from '$lib/media/import';
import { claude } from './state';
import type { ExportProgress } from './protocol';

export type ToolArgs = Record<string, unknown>;

export interface ToolContext {
  // something happened that the server did not ask about, export progress mostly
  emit(name: string, data: unknown): void;
}

type Handler = (args: ToolArgs, ctx: ToolContext) => Promise<unknown> | unknown;

const labels: Label[] = [
  'none', 'violet', 'iris', 'caribbean', 'lavender', 'cerulean', 'forest', 'rose', 'mango',
  'purple', 'blue', 'teal', 'magenta', 'tan', 'green', 'brown', 'yellow'
];
const easings: Easing[] = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'];

// ---- small helpers ----------------------------------------------------------

const s3 = (n: number): number => Math.round(n * 1000) / 1000;

function num(value: unknown, name: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function optNum(value: unknown, name: string): number | undefined {
  return value === undefined || value === null ? undefined : num(value, name);
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} must be a non-empty string`);
  return value;
}

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function requireProject(): Project {
  const p = get(project);
  if (!p) throw new Error('No project is open. Call new_project, or open one in the tab.');
  return p;
}

function sequenceOf(p: Project, sequenceId: unknown): Sequence {
  if (typeof sequenceId === 'string' && sequenceId) {
    const s = p.sequences.find((x) => x.id === sequenceId);
    if (!s) throw new Error(`No sequence with id ${sequenceId}; see status`);
    return s;
  }
  const s = get(activeSequence);
  if (!s) throw new Error('The project has no sequence. Call new_sequence.');
  return s;
}

// one undo step inside one sequence, the active one unless an id is given
function editIn(label: string, sequenceId: unknown, recipe: (s: Sequence, draft: Project) => void): void {
  const target = sequenceOf(requireProject(), sequenceId).id;
  edit(label, (draft) => {
    const s = draft.sequences.find((x) => x.id === target);
    if (s) recipe(s, draft);
  });
}

// one undo step around a clip, wherever it lives
function editClip(label: string, clipId: string, recipe: (s: Sequence, clip: Clip, track: Track) => void): void {
  const located = findClip(requireProject(), clipId);
  if (!located) throw new Error(`No clip with id ${clipId}; see get_timeline`);
  editIn(label, located.sequence.id, (s) => {
    const found = ops.findClipById(s, clipId);
    if (found) recipe(s, found.clip, found.track);
  });
}

const getMedia = (mediaId: Id): MediaItem | undefined => get(mediaById).get(mediaId);

function tracksOfKind(s: Sequence, kind: TrackKind): Track[] {
  return s.tracks.filter((t) => t.kind === kind);
}

// the nth track of a kind, made on the spot when the sequence has fewer
function trackAt(s: Sequence, kind: TrackKind, index: number): Track {
  if (!Number.isInteger(index) || index < 0) throw new Error('trackIndex must be a whole number from 0');
  while (tracksOfKind(s, kind).length <= index) ops.addTrack(s, kind);
  return tracksOfKind(s, kind)[index];
}

function lastEnd(track: Track): number {
  return track.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
}

function fixedEffect(clip: Clip, type: string): EffectInstance {
  const effect = clip.effects.find((e) => e.type === type);
  if (!effect) throw new Error(`${clip.name} has no ${type}`);
  return effect;
}

function tc(time: number, fps: number): string {
  return formatTimecode(time, fps);
}

// highlight what claude touched and bring it into view
function reveal(clipIds: Id[]): void {
  if (!clipIds.length) return;
  selectClips(clipIds);
  selectedTransitionId.set(null);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('braincut:reveal-clip', { detail: { clipId: clipIds[0] } }));
  }
}

function coerce(def: ParamDef, value: unknown): ParamValue {
  switch (def.kind) {
    case 'number':
    case 'angle': {
      const n = num(value, def.key);
      return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, n));
    }
    case 'boolean':
      return Boolean(value);
    case 'color':
      return str(value, def.key);
    case 'select': {
      const options = def.options ?? [];
      if (typeof value !== 'string' || !options.some((o) => o.value === value)) {
        throw new Error(`${def.key} must be one of ${options.map((o) => o.value).join(', ')}`);
      }
      return value;
    }
    case 'point': {
      if (!Array.isArray(value) || value.length !== 2) throw new Error(`${def.key} must be [x, y]`);
      return [num(value[0], def.key), num(value[1], def.key)];
    }
  }
}

function applyParams(effect: EffectInstance, params: unknown, clipTime: number | null): void {
  if (params === undefined || params === null) return;
  if (typeof params !== 'object') throw new Error('params must be an object');
  for (const [key, raw] of Object.entries(params as Record<string, unknown>)) {
    const def = paramDef(effect.type, key);
    if (!def) throw new Error(`${effect.type} has no parameter "${key}"; see catalog("effects")`);
    const value = coerce(def, raw);
    // an animated parameter takes the value as a keyframe where the playhead is
    if (clipTime !== null && effect.keyframes[key]?.length) setKeyframe(effect, key, clipTime, value);
    else effect.params[key] = value;
  }
}

function describeEffect(e: EffectInstance): Record<string, unknown> {
  return {
    id: e.id,
    type: e.type,
    name: effectDef(e.type)?.name ?? e.type,
    enabled: e.enabled,
    fixed: e.fixed ?? false,
    params: e.params,
    animated: Object.keys(e.keyframes).filter((k) => e.keyframes[k].length)
  };
}

function describeClip(clip: Clip, fps: number): Record<string, unknown> {
  const media = clip.mediaId ? getMedia(clip.mediaId) : undefined;
  return {
    id: clip.id,
    kind: clip.kind,
    name: clip.name,
    mediaId: clip.mediaId,
    mediaName: media?.name,
    start: s3(clip.start),
    end: s3(clipEnd(clip)),
    duration: s3(clip.duration),
    timecode: `${tc(clip.start, fps)} - ${tc(clipEnd(clip), fps)}`,
    sourceIn: s3(clip.in),
    speed: clip.speed,
    reverse: clip.reverse,
    enabled: clip.enabled,
    linkId: clip.linkId,
    effects: clip.effects.map(describeEffect),
    title: clip.title ? { text: clip.title.text, fontFamily: clip.title.fontFamily, fontSize: clip.title.fontSize, color: clip.title.color, box: clip.title.box } : undefined,
    color: clip.color
  };
}

function describeSequence(s: Sequence, active: boolean): Record<string, unknown> {
  return {
    id: s.id,
    name: s.name,
    width: s.width,
    height: s.height,
    fps: s.fps,
    duration: s3(sequenceDuration(s)),
    tracks: s.tracks.length,
    active
  };
}

async function player() {
  const { program } = await import('$lib/engine/session');
  return program().player;
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    return 'createWritable' in FileSystemFileHandle.prototype ? root : null;
  } catch {
    return null;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// ---- the tools ----------------------------------------------------------------

const handlers: Record<string, Handler> = {
  status() {
    const p = get(project);
    const seq = get(activeSequence);
    const h = get(history);
    return {
      version,
      project: p ? { id: p.id, name: p.name, media: p.media.length, unsaved: get(dirty) } : null,
      sequences: p ? p.sequences.map((s) => describeSequence(s, s.id === seq?.id)) : [],
      activeSequenceId: seq?.id ?? null,
      playhead: s3(get(playhead)),
      playing: get(playing),
      selection: get(selection),
      history: { steps: h.index, canUndo: h.canUndo, lastEdit: h.undoLabel },
      lastAction: get(claude).lastAction
    };
  },

  get_timeline({ sequenceId }) {
    const s = sequenceOf(requireProject(), sequenceId);
    const counters: Record<TrackKind, number> = { video: 0, audio: 0 };
    return {
      ...describeSequence(s, s.id === get(activeSequence)?.id),
      inPoint: s.inPoint,
      outPoint: s.outPoint,
      tracks: s.tracks.map((t) => ({
        id: t.id,
        kind: t.kind,
        name: t.name,
        index: counters[t.kind]++,
        muted: t.muted,
        locked: t.locked,
        hidden: t.hidden,
        clips: t.clips.map((c) => describeClip(c, s.fps)),
        transitions: t.transitions.map((x) => ({
          id: x.id,
          type: x.type,
          name: transitionDef(x.type)?.name ?? x.type,
          leftClipId: x.leftClipId,
          rightClipId: x.rightClipId,
          start: s3(x.start),
          duration: s3(x.duration)
        }))
      })),
      markers: s.markers.map((m) => ({ id: m.id, time: s3(m.time), name: m.name, color: m.color }))
    };
  },

  list_media() {
    return requireProject().media.map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      status: m.status,
      statusReason: m.statusReason,
      duration: s3(m.duration),
      width: m.width,
      height: m.height,
      fps: m.fps,
      hasVideo: m.hasVideo,
      hasAudio: m.hasAudio,
      videoCodec: m.videoCodec,
      audioCodec: m.audioCodec,
      container: m.container,
      fileSize: m.fileSize,
      proxy: m.proxy !== null
    }));
  },

  async catalog({ kind }) {
    switch (kind) {
      case 'effects':
        return effectDefs
          .filter((d) => d.kind !== 'fixed')
          .map((d) => ({
            id: d.type,
            name: d.name,
            group: d.group,
            kind: d.kind,
            description: d.description,
            params: d.params.map((p) => ({
              key: p.key,
              label: p.label,
              kind: p.kind,
              min: p.min,
              max: p.max,
              default: p.default,
              unit: p.unit,
              options: p.options?.map((o) => o.value)
            }))
          }));
      case 'transitions':
        return transitionDefs.map((d) => ({ id: d.id, name: d.name, group: d.group, kind: d.kind, description: d.description }));
      case 'export_presets': {
        const { availablePresets } = await import('$lib/export/presets');
        return (await availablePresets()).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          container: p.settings.container
        }));
      }
      case 'sequence_templates':
        return sequencePresets.map((p) => ({ id: p.id, name: p.name, width: p.width, height: p.height, fps: p.fps, description: p.description }));
      case 'blend_modes':
        return paramDef('opacity', 'blendMode')?.options?.map((o) => o.value) ?? [];
      case 'fonts': {
        const { fontFamilies } = await import('$lib/engine/text');
        return [...fontFamilies];
      }
      default:
        throw new Error(`Unknown catalog "${String(kind)}"`);
    }
  },

  async frame({ time, width, sequenceId }) {
    const s = sequenceOf(requireProject(), sequenceId);
    const t = Math.max(0, optNum(time, 'time') ?? get(playhead));
    const { exportFrame } = await import('$lib/export/frame');
    const blob = await exportFrame(s, t, { format: 'png' }, getMedia);
    const targetWidth = Math.min(optNum(width, 'width') ?? 960, s.width);
    const bitmap = await createImageBitmap(blob);
    const scale = targetWidth / bitmap.width;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a drawing context');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The browser could not encode the frame');
    return { png: base64(new Uint8Array(await png.arrayBuffer())), width: w, height: h, time: s3(t), summary: `frame at ${tc(t, s.fps)}` };
  },

  async import_media({ files }) {
    requireProject();
    if (!Array.isArray(files) || !files.length) throw new Error('files must be a non-empty list');
    const { importFiles } = await import('$lib/media/import');
    const results: Record<string, unknown>[] = [];
    const entries: { entry: ImportEntry; path: string }[] = [];
    const root = await opfsRoot();
    for (const raw of files as { url: string; name: string; path: string; lastModified?: number }[]) {
      try {
        const response = await fetch(raw.url);
        if (!response.ok || !response.body) throw new Error(`the server answered ${response.status}`);
        let entry: ImportEntry;
        if (root) {
          // streamed straight to disk in the browser's private storage, so a
          // big file never sits in memory and the handle survives a reload
          const folder = await (await root.getDirectoryHandle('agent-imports', { create: true })).getDirectoryHandle(newId(), { create: true });
          const handle = await folder.getFileHandle(raw.name, { create: true });
          await response.body.pipeTo(await handle.createWritable());
          entry = { file: await handle.getFile(), handle, path: raw.path };
        } else {
          const blob = await response.blob();
          entry = { file: new File([blob], raw.name, { type: blob.type, lastModified: raw.lastModified }), handle: null, path: raw.path };
        }
        entries.push({ entry, path: raw.path });
      } catch (error) {
        results.push({ path: raw.path, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (entries.length) {
      const items = await importFiles(entries.map((e) => e.entry));
      items.forEach((item, i) => {
        results.push({
          path: entries[i]?.path,
          ok: item.status === 'ready',
          mediaId: item.id,
          name: item.name,
          kind: item.kind,
          status: item.status,
          statusReason: item.statusReason,
          duration: s3(item.duration),
          width: item.width,
          height: item.height,
          fps: item.fps
        });
      });
    }
    const ready = results.filter((r) => r.ok).length;
    return { files: results, summary: `imported ${ready} of ${files.length}` };
  },

  add_clip({ mediaId, at, trackIndex, sourceIn, sourceOut, sequenceId }) {
    const media = getMedia(str(mediaId, 'mediaId'));
    if (!media) throw new Error(`No media with id ${String(mediaId)}; see list_media`);
    if (media.status !== 'ready') {
      throw new Error(`${media.name} is ${media.status}${media.statusReason ? `: ${media.statusReason}` : ''}`);
    }
    const index = optNum(trackIndex, 'trackIndex') ?? 0;
    const inPoint = optNum(sourceIn, 'sourceIn');
    const outPoint = optNum(sourceOut, 'sourceOut');
    if (inPoint !== undefined && outPoint !== undefined && outPoint <= inPoint) throw new Error('sourceOut must be after sourceIn');
    let placed: Id[] = [];
    let made: { video?: Clip; audio?: Clip } = {};
    let start = 0;
    let trackName = '';
    editIn('add clip', sequenceId, (s) => {
      const kind: TrackKind = media.kind === 'audio' ? 'audio' : 'video';
      const track = trackAt(s, kind, index);
      const audioTrack = kind === 'video' && media.hasAudio ? trackAt(s, 'audio', index) : null;
      start = at === undefined || at === 'end'
        ? Math.max(lastEnd(track), audioTrack ? lastEnd(audioTrack) : 0)
        : snapToFrame(Math.max(0, num(at, 'at')), s.fps);
      made = createClipFromMedia(media, start, {
        fps: s.fps,
        in: inPoint,
        duration: outPoint !== undefined ? outPoint - (inPoint ?? 0) : undefined,
        stillDuration: get(preferences).stillImageDuration
      });
      const placements: ops.Placement[] = [];
      if (made.video) placements.push({ trackId: track.id, clip: made.video });
      if (made.audio) placements.push({ trackId: (audioTrack ?? track).id, clip: made.audio });
      placed = ops.placeClips(s, placements, 'overwrite');
      trackName = track.name;
    });
    if (!placed.length) throw new Error('The clip could not be placed; is the track locked?');
    reveal(placed);
    const s = sequenceOf(requireProject(), sequenceId);
    const found = ops.findClipById(s, placed[0]);
    const clip = found?.clip;
    return {
      clipId: made.video?.id ?? made.audio?.id,
      audioClipId: made.video ? made.audio?.id : undefined,
      start: s3(clip?.start ?? start),
      end: s3(clip ? clipEnd(clip) : start),
      track: trackName,
      summary: `${media.name} on ${trackName} at ${tc(start, s.fps)}`
    };
  },

  add_title(args) {
    const text = str(args.text, 'text');
    let placed: Id[] = [];
    let start = 0;
    let end = 0;
    let fps = 25;
    editIn('add title', args.sequenceId, (s) => {
      fps = s.fps;
      const index = optNum(args.trackIndex, 'trackIndex');
      const videoTracks = tracksOfKind(s, 'video');
      const track = index === undefined ? videoTracks[videoTracks.length - 1] : trackAt(s, 'video', index);
      start = snapToFrame(Math.max(0, optNum(args.at, 'at') ?? get(playhead)), s.fps);
      const duration = Math.max(1 / s.fps, snapToFrame(optNum(args.duration, 'duration') ?? 5, s.fps));
      const clip = createTitleClip(start, duration, text);
      const title = clip.title!;
      const font = optStr(args.fontFamily);
      if (font) title.fontFamily = font;
      const size = optNum(args.fontSize, 'fontSize');
      if (size) title.fontSize = Math.max(1, size);
      const weight = optNum(args.fontWeight, 'fontWeight');
      if (weight !== undefined) {
        title.fontWeight = ([400, 500, 600, 700] as const).reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
      }
      const color = optStr(args.color);
      if (color) title.color = color;
      if (args.align === 'left' || args.align === 'center' || args.align === 'right') title.align = args.align;
      const strokeWidth = optNum(args.strokeWidth, 'strokeWidth');
      const strokeColor = optStr(args.strokeColor);
      if (strokeWidth || strokeColor) title.stroke = { color: strokeColor ?? '#000000', width: strokeWidth ?? 4 };
      if (args.shadow) title.shadow = { color: '#000000', blur: 12, x: 0, y: 4 };
      if (args.box) title.background = { color: optStr(args.boxColor) ?? '#000000', padding: 24 };
      const x = optNum(args.x, 'x');
      const y = optNum(args.y, 'y');
      // fractions of the frame, kept to four places so 0.5 - 0.4 is 0.1 and not a float tail
      const fraction = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
      if (x !== undefined) title.box = { ...title.box, x: fraction(Math.min(1 - title.box.width, x - title.box.width / 2)) };
      if (y !== undefined) title.box = { ...title.box, y: fraction(y) };
      placed = ops.placeClips(s, [{ trackId: track.id, clip }], 'overwrite');
      end = start + duration;
    });
    if (!placed.length) throw new Error('The title could not be placed; is the track locked?');
    reveal(placed);
    return { clipId: placed[0], start: s3(start), end: s3(end), summary: `title "${text}" at ${tc(start, fps)}` };
  },

  split({ at, clipId, sequenceId }) {
    const time = num(at, 'at');
    const target = typeof clipId === 'string' ? clipId : null;
    const p = requireProject();
    const s = target ? findClip(p, target)?.sequence : sequenceOf(p, sequenceId);
    if (!s) throw new Error(`No clip with id ${target}; see get_timeline`);
    const before = target ? ops.linkedClips(s, target).map((c) => c.id) : ops.clipsAt(s, time).map((c) => c.id);
    let right: Id[] = [];
    editIn('split', s.id, (draft) => {
      right = ops.splitClipsAt(draft, snapToFrame(time, draft.fps), target ? before : 'all-unlocked');
    });
    if (!right.length) throw new Error(`Nothing to split at ${tc(time, s.fps)}; the time has to fall inside a clip`);
    reveal(right);
    return { left: before, right, summary: `split at ${tc(time, s.fps)}` };
  },

  trim({ clipId, start, end, ripple }) {
    const id = str(clipId, 'clipId');
    const newStart = optNum(start, 'start');
    const newEnd = optNum(end, 'end');
    if (newStart === undefined && newEnd === undefined) throw new Error('give start, end or both');
    let result = { start: 0, end: 0, fps: 25 };
    editClip('trim', id, (s) => {
      const ids = ops.linkedClips(s, id).map((c) => c.id);
      const opts = { ripple: Boolean(ripple), getMedia };
      if (newStart !== undefined) ops.trimEdges(s, ids.map((c) => ({ clipId: c, edge: 'head' as const })), snapToFrame(newStart, s.fps), opts);
      if (newEnd !== undefined) ops.trimEdges(s, ids.map((c) => ({ clipId: c, edge: 'tail' as const })), snapToFrame(newEnd, s.fps), opts);
      const clip = ops.findClipById(s, id)?.clip;
      if (clip) result = { start: clip.start, end: clipEnd(clip), fps: s.fps };
    });
    reveal([id]);
    return { clipId: id, start: s3(result.start), end: s3(result.end), summary: `trimmed to ${tc(result.start, result.fps)} - ${tc(result.end, result.fps)}` };
  },

  move_clip({ clipId, to, trackIndex }) {
    const id = str(clipId, 'clipId');
    const time = Math.max(0, num(to, 'to'));
    const index = optNum(trackIndex, 'trackIndex');
    let ok = false;
    let result = { start: 0, end: 0, track: '', fps: 25 };
    editClip('move clip', id, (s, _clip, track) => {
      const target = index === undefined ? track : trackAt(s, track.kind, index);
      ok = ops.moveClips(s, [{ clipId: id, trackId: target.id, start: snapToFrame(time, s.fps) }], 'overwrite', { keepLinked: true });
      const moved = ops.findClipById(s, id);
      if (moved) result = { start: moved.clip.start, end: clipEnd(moved.clip), track: moved.track.name, fps: s.fps };
    });
    if (!ok) throw new Error('The clip could not be moved there; the track may be locked or of the wrong kind');
    reveal([id]);
    return { clipId: id, ...result, start: s3(result.start), end: s3(result.end), summary: `moved to ${result.track} at ${tc(result.start, result.fps)}` };
  },

  delete_clips({ clipIds, ripple }) {
    if (!Array.isArray(clipIds) || !clipIds.length) throw new Error('clipIds must be a non-empty list');
    const first = str(clipIds[0], 'clipIds');
    const located = findClip(requireProject(), first);
    if (!located) throw new Error(`No clip with id ${first}; see get_timeline`);
    let deleted: Id[] = [];
    editIn(ripple ? 'ripple delete' : 'delete', located.sequence.id, (s) => {
      deleted = [...new Set((clipIds as unknown[]).flatMap((c) => ops.linkedClips(s, str(c, 'clipIds')).map((x) => x.id)))];
      if (ripple) ops.rippleDelete(s, deleted);
      else ops.deleteClips(s, deleted);
    });
    clearSelection();
    return { deleted, summary: `${ripple ? 'ripple deleted' : 'deleted'} ${deleted.length} clip${deleted.length === 1 ? '' : 's'}` };
  },

  set_clip(args) {
    const id = str(args.clipId, 'clipId');
    const changed: string[] = [];
    editClip('set clip', id, (s, clip) => {
      const linked = ops.linkedClips(s, id);
      const speed = optNum(args.speed, 'speed');
      if (speed !== undefined) {
        if (speed <= 0) throw new Error('speed must be above 0');
        ops.setClipSpeed(s, id, speed, { getMedia });
        changed.push(`speed ${speed}`);
      }
      const opacity = optNum(args.opacity, 'opacity');
      if (opacity !== undefined && clip.kind !== 'audio') {
        fixedEffect(clip, 'opacity').params.opacity = Math.min(100, Math.max(0, opacity * 100));
        changed.push(`opacity ${opacity}`);
      }
      const blendMode = optStr(args.blendMode);
      if (blendMode && clip.kind !== 'audio') {
        const def = paramDef('opacity', 'blendMode');
        if (def) fixedEffect(clip, 'opacity').params.blendMode = coerce(def, blendMode);
        changed.push(blendMode);
      }
      if (args.position && typeof args.position === 'object' && clip.kind !== 'audio') {
        const pos = args.position as { x?: unknown; y?: unknown };
        fixedEffect(clip, 'transform').params.position = [num(pos.x, 'position.x'), num(pos.y, 'position.y')];
        changed.push('position');
      }
      const scale = optNum(args.scale, 'scale');
      if (scale !== undefined && clip.kind !== 'audio') {
        const transform = fixedEffect(clip, 'transform');
        transform.params.scale = Math.max(0, scale * 100);
        transform.params.scaleY = Math.max(0, scale * 100);
        changed.push(`scale ${scale}`);
      }
      const rotation = optNum(args.rotation, 'rotation');
      if (rotation !== undefined && clip.kind !== 'audio') {
        fixedEffect(clip, 'transform').params.rotation = rotation;
        changed.push(`rotation ${rotation}`);
      }
      const volume = optNum(args.volume, 'volume');
      const muted = typeof args.muted === 'boolean' ? args.muted : undefined;
      if (volume !== undefined || muted !== undefined) {
        for (const c of linked) {
          if (c.kind !== 'audio') continue;
          const level = c.effects.find((e) => e.type === 'volume');
          if (!level) continue;
          level.params.level = muted ? -60 : Math.min(12, Math.max(-60, volume ?? (muted === false ? 0 : num(level.params.level, 'level'))));
        }
        changed.push(muted !== undefined ? (muted ? 'muted' : 'unmuted') : `volume ${volume} dB`);
      }
      if (typeof args.enabled === 'boolean') {
        ops.setEnabled(s, linked.map((c) => c.id), args.enabled);
        changed.push(args.enabled ? 'enabled' : 'disabled');
      }
      const name = optStr(args.name);
      if (name) {
        clip.name = name;
        changed.push(`named ${name}`);
      }
    });
    if (!changed.length) throw new Error('Nothing to change; give at least one field');
    reveal([id]);
    const clip = findClip(requireProject(), id);
    return { clipId: id, changed, clip: clip ? describeClip(clip.clip, clip.sequence.fps) : undefined, summary: changed.join(', ') };
  },

  add_transition({ clipId, type, duration, edge }) {
    const id = str(clipId, 'clipId');
    const requested = optStr(type);
    if (requested && !transitionDef(requested)) throw new Error(`Unknown transition "${requested}"; see catalog("transitions")`);
    const side = edge === 'in' ? 'in' : 'out';
    const prefs = get(preferences);
    const length = Math.max(0.04, optNum(duration, 'duration') ?? prefs.defaultTransitionDuration);
    const created: Record<string, unknown> = {};
    editClip('add transition', id, (s) => {
      const videoType = requested && !isAudioTransitionType(requested) ? requested : prefs.defaultVideoTransition;
      const audioType = requested && isAudioTransitionType(requested) ? requested : prefs.defaultAudioTransition;
      for (const clip of ops.linkedClips(s, id)) {
        const track = ops.trackOf(s, clip.id);
        if (!track) continue;
        const at = track.clips.findIndex((c) => c.id === clip.id);
        const neighbour = side === 'in' ? track.clips[at - 1] : track.clips[at + 1];
        const adjacent = neighbour !== undefined && (side === 'in' ? nearlyEqual(clipEnd(neighbour), clip.start) : nearlyEqual(clipEnd(clip), neighbour.start));
        const made = ops.addTransition(s, track.id, {
          type: track.kind === 'audio' ? audioType : videoType,
          leftClipId: side === 'in' ? (adjacent ? neighbour.id : null) : clip.id,
          rightClipId: side === 'in' ? clip.id : adjacent ? neighbour.id : null,
          duration: length
        });
        if (made) created[track.kind === 'audio' ? 'audioTransitionId' : 'transitionId'] = made;
      }
    });
    if (!Object.keys(created).length) throw new Error('No cut to put a transition on');
    reveal([id]);
    return { ...created, duration: s3(length), summary: `${requested ?? 'default transition'} ${side === 'in' ? 'into' : 'out of'} the clip` };
  },

  add_effect({ clipId, type, params }) {
    const id = str(clipId, 'clipId');
    const kind = str(type, 'type');
    const def = effectDef(kind);
    if (!def || def.kind === 'fixed') throw new Error(`Unknown effect "${kind}"; see catalog("effects")`);
    let effectId = '';
    let targetName = '';
    editClip(`add ${def.name.toLowerCase()}`, id, (s, clip) => {
      // an audio effect asked of a video clip lands on its linked audio
      const target = def.kind === 'audio' && clip.kind !== 'audio'
        ? ops.linkedClips(s, id).find((c) => c.kind === 'audio')
        : def.kind === 'video' && clip.kind === 'audio'
          ? ops.linkedClips(s, id).find((c) => c.kind !== 'audio')
          : clip;
      if (!target) throw new Error(`${def.name} is a${def.kind === 'audio' ? 'n audio' : ' video'} effect and ${clip.name} has no ${def.kind} side`);
      const instance = createEffectInstance(kind);
      applyParams(instance, params, null);
      target.effects.push(instance);
      effectId = instance.id;
      targetName = target.name;
    });
    reveal([id]);
    return { effectId, type: kind, name: def.name, clip: targetName, summary: `${def.name} on ${targetName}` };
  },

  set_effect({ clipId, effectId, params, enabled }) {
    const id = str(clipId, 'clipId');
    const eid = str(effectId, 'effectId');
    let result: Record<string, unknown> | undefined;
    editClip('set effect', id, (s, clip) => {
      for (const c of ops.linkedClips(s, id)) {
        const effect = c.effects.find((e) => e.id === eid);
        if (!effect) continue;
        applyParams(effect, params, get(playhead) - c.start);
        if (typeof enabled === 'boolean' && !effect.fixed) effect.enabled = enabled;
        result = describeEffect(effect);
        return;
      }
      throw new Error(`${clip.name} has no effect with id ${eid}`);
    });
    reveal([id]);
    return { ...result, summary: `${String(result?.name)} changed` };
  },

  remove_effect({ clipId, effectId }) {
    const id = str(clipId, 'clipId');
    const eid = str(effectId, 'effectId');
    let removed = '';
    editClip('remove effect', id, (s, clip) => {
      for (const c of ops.linkedClips(s, id)) {
        const effect = c.effects.find((e) => e.id === eid);
        if (!effect) continue;
        if (effect.fixed) throw new Error(`${effectDef(effect.type)?.name ?? effect.type} is built into every clip and cannot be removed`);
        c.effects = c.effects.filter((e) => e.id !== eid);
        removed = effectDef(effect.type)?.name ?? effect.type;
        return;
      }
      throw new Error(`${clip.name} has no effect with id ${eid}`);
    });
    return { removed: eid, summary: `${removed} removed` };
  },

  add_keyframe({ clipId, param, time, value, easing }) {
    const id = str(clipId, 'clipId');
    const path = str(param, 'param');
    const at = num(time, 'time');
    const ease = easing === undefined ? 'linear' : (easings.find((e) => e === easing) ?? null);
    if (!ease) throw new Error(`easing must be one of ${easings.join(', ')}`);
    let result: Record<string, unknown> = {};
    editClip('add keyframe', id, (s, clip) => {
      const linked = ops.linkedClips(s, id);
      const audio = clip.kind === 'audio' ? clip : linked.find((c) => c.kind === 'audio');
      const visual = clip.kind === 'audio' ? linked.find((c) => c.kind !== 'audio') : clip;
      let target: Clip | undefined;
      let effect: EffectInstance | undefined;
      let key = '';
      let stored: ParamValue;
      const clipTimeOf = (c: Clip) => {
        const t = snapToFrame(at, s.fps) - c.start;
        if (t < -1e-6 || t > c.duration + 1e-6) {
          throw new Error(`${tc(at, s.fps)} is outside ${c.name} (${tc(c.start, s.fps)} - ${tc(clipEnd(c), s.fps)})`);
        }
        return Math.max(0, t);
      };
      if (path === 'opacity' || path === 'scale' || path === 'rotation' || path === 'position.x' || path === 'position.y') {
        target = visual;
        if (!target) throw new Error(`${clip.name} has no picture to animate`);
        const clipTime = clipTimeOf(target);
        if (path === 'opacity') {
          effect = fixedEffect(target, 'opacity');
          key = 'opacity';
          stored = Math.min(100, Math.max(0, num(value, 'value') * 100));
        } else {
          effect = fixedEffect(target, 'transform');
          if (path === 'scale') {
            key = 'scale';
            stored = Math.max(0, num(value, 'value') * 100);
            setKeyframe(effect, 'scaleY', clipTime, stored, ease);
          } else if (path === 'rotation') {
            key = 'rotation';
            stored = num(value, 'value');
          } else {
            key = 'position';
            const current = valueAt(effect, 'position', clipTime, [0, 0]) as [number, number];
            stored = path === 'position.x' ? [num(value, 'value'), current[1]] : [current[0], num(value, 'value')];
          }
        }
        setKeyframe(effect, key, clipTime, stored, ease);
      } else if (path === 'volume') {
        target = audio;
        if (!target) throw new Error(`${clip.name} has no sound to animate`);
        effect = fixedEffect(target, 'volume');
        key = 'level';
        stored = Math.min(12, Math.max(-60, num(value, 'value')));
        setKeyframe(effect, key, clipTimeOf(target), stored, ease);
      } else if (path.startsWith('effect:')) {
        const [, effectId, paramKey] = path.split(':');
        if (!effectId || !paramKey) throw new Error('param must look like effect:<effectId>:<paramName>');
        for (const c of linked) {
          const found = c.effects.find((e) => e.id === effectId);
          if (found) {
            target = c;
            effect = found;
          }
        }
        if (!target || !effect) throw new Error(`${clip.name} has no effect with id ${effectId}`);
        const def = paramDef(effect.type, paramKey);
        if (!def) throw new Error(`${effect.type} has no parameter "${paramKey}"`);
        if (!def.animatable) throw new Error(`${paramKey} cannot be animated`);
        key = paramKey;
        stored = coerce(def, value);
        setKeyframe(effect, key, clipTimeOf(target), stored, ease);
      } else {
        throw new Error('param must be opacity, position.x, position.y, scale, rotation, volume or effect:<effectId>:<paramName>');
      }
      result = { effectId: effect.id, key, time: s3(at), value: stored, keyframes: effect.keyframes[key]?.length ?? 0, fps: s.fps };
    });
    reveal([id]);
    return { ...result, summary: `${path} keyframe at ${tc(at, result.fps as number)}` };
  },

  add_marker({ time, name, color, sequenceId }) {
    const label = optStr(color);
    if (label && !labels.includes(label as Label)) throw new Error(`color must be one of ${labels.join(', ')}`);
    let markerId = '';
    let at = 0;
    let fps = 25;
    editIn('add marker', sequenceId, (s) => {
      fps = s.fps;
      at = snapToFrame(Math.max(0, optNum(time, 'time') ?? get(playhead)), s.fps);
      markerId = ops.addMarker(s, createMarker(at, { name: optStr(name) ?? '', color: (label as Label | undefined) ?? 'green' }));
    });
    return { markerId, time: s3(at), summary: `marker at ${tc(at, fps)}` };
  },

  new_sequence({ name, template, width, height, fps }) {
    const p = requireProject();
    const tpl = template === undefined ? undefined : presetById(str(template, 'template'));
    if (template !== undefined && !tpl) throw new Error(`Unknown template "${String(template)}"; see catalog("sequence_templates")`);
    const seq = createSequence({
      name: optStr(name) ?? `Sequence ${p.sequences.length + 1}`,
      width: Math.round(optNum(width, 'width') ?? tpl?.width ?? 1920),
      height: Math.round(optNum(height, 'height') ?? tpl?.height ?? 1080),
      fps: optNum(fps, 'fps') ?? tpl?.fps ?? 30
    });
    edit('new sequence', (draft) => {
      draft.sequences.push(seq);
    });
    setActiveSequence(seq.id);
    return { ...describeSequence(seq, true), summary: `${seq.name} ${seq.width}x${seq.height} ${seq.fps} fps` };
  },

  set_active_sequence({ sequenceId }) {
    const s = sequenceOf(requireProject(), str(sequenceId, 'sequenceId'));
    setActiveSequence(s.id);
    return { ...describeSequence(s, true), summary: `switched to ${s.name}` };
  },

  select({ clipIds }) {
    if (!Array.isArray(clipIds)) throw new Error('clipIds must be a list');
    const ids = clipIds.map((c) => str(c, 'clipIds'));
    if (!ids.length) {
      clearSelection();
      return { selection: [], summary: 'selection cleared' };
    }
    reveal(ids);
    return { selection: get(selection), summary: `${ids.length} selected` };
  },

  async seek({ time }) {
    const p = await player();
    p.seek(Math.max(0, num(time, 'time')));
    const t = p.currentTime();
    return { time: s3(t), summary: `at ${tc(t, get(activeSequence)?.fps ?? 25)}` };
  },

  async play({ from, until }) {
    const p = await player();
    const start = optNum(from, 'from');
    const stop = optNum(until, 'until');
    if (start !== undefined) p.seek(Math.max(0, start));
    p.play();
    if (stop !== undefined) {
      let armed = false;
      const unsubscribe = p.time.subscribe((t) => {
        if (!armed) {
          armed = t < stop;
          if (armed) return;
        }
        if (t >= stop) {
          p.pause();
          queueMicrotask(unsubscribe);
        }
      });
    }
    return { playing: true, from: s3(p.currentTime()), until: stop, summary: 'playing' };
  },

  async pause() {
    const p = await player();
    p.pause();
    return { playing: false, time: s3(p.currentTime()), summary: 'paused' };
  },

  new_project({ name, force }) {
    if (get(project) && get(dirty) && !force) {
      throw new Error('The open project has unsaved changes. Call save_project first, or pass force: true to discard them.');
    }
    const title = optStr(name) ?? 'Untitled project';
    const p = createProject(title);
    const seq = createSequence({ name: 'Sequence 1', width: 1920, height: 1080, fps: 30 });
    p.sequences.push(seq);
    p.activeSequenceId = seq.id;
    loadProject(p);
    touchRecent(p).catch(() => {});
    setLastOpenedId(p.id).catch(() => {});
    return { projectId: p.id, name: title, sequenceId: seq.id, summary: `${title} created` };
  },

  save_project() {
    const p = requireProject();
    const json = serializeProject(p);
    markSaved();
    return { json, name: projectFileName(p), summary: 'saved' };
  },

  undo() {
    const h = get(history);
    if (!h.canUndo) throw new Error('Nothing to undo');
    const label = h.undoLabel;
    undo();
    return { undone: label, canUndo: get(history).canUndo, summary: `undid ${label}` };
  },

  redo() {
    const h = get(history);
    if (!h.canRedo) throw new Error('Nothing to redo');
    const label = h.redoLabel;
    redo();
    return { redone: label, canRedo: get(history).canRedo, summary: `redid ${label}` };
  },

  async export({ jobId, uploadUrl, preset, sequenceId, path }, ctx) {
    const job = str(jobId, 'jobId');
    const url = str(uploadUrl, 'uploadUrl');
    const seq = sequenceOf(requireProject(), sequenceId);
    if (get(exportJob)) throw new Error('An export is already running');
    const presetsModule = await import('$lib/export/presets');
    const { exportSequence } = await import('$lib/export/render');
    const def = presetsModule.findPreset(optStr(preset) ?? 'youtube-1080');
    if (!def) throw new Error(`Unknown preset "${String(preset)}"; see catalog("export_presets")`);
    const resolved = await presetsModule.resolveCodecs(presetsModule.settingsFromPreset(def, seq), undefined, seq.sampleRate);
    const root = await opfsRoot();
    if (!root) throw new Error('This browser cannot stream an export to a file; use Chrome, Edge or another Chromium browser');
    const folder = await root.getDirectoryHandle('agent-exports', { create: true });
    const fileName = `${job}.${resolved.settings.container}`;
    const handle = await folder.getFileHandle(fileName, { create: true });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const media = get(mediaById);
    const report = (progress: ExportProgress) => ctx.emit('export-progress', progress);
    renderStatus.set('rendering');
    exportJob.set({ progress: 0, stage: 'Starting', eta: null, cancel });

    // the call answers right away; the render runs on and reports through events
    void (async () => {
      try {
        report({ jobId: job, state: 'running', progress: 0, message: 'Starting' });
        const { bytes } = await exportSequence(
          seq,
          resolved.settings,
          { kind: 'handle', handle },
          {
            signal: controller.signal,
            onProgress(progress, stage, eta) {
              exportJob.set({ progress, stage, eta, cancel });
              report({ jobId: job, state: 'running', progress: progress * 0.95, message: stage });
            },
            onNote(note) {
              addToast(note, 'warning', 6000);
            }
          },
          (mediaId) => media.get(mediaId)
        );
        exportJob.set({ progress: 0.95, stage: 'Handing over', eta: null, cancel });
        report({ jobId: job, state: 'uploading', progress: 0.95, message: 'Handing the file to braincut-mcp' });
        const response = await fetch(url, { method: 'PUT', body: await handle.getFile(), signal: controller.signal });
        if (!response.ok) throw new Error(`braincut-mcp could not write the file (${response.status})`);
        addToast(`Exported ${optStr(path) ?? fileName} (${mb(bytes)})`, 'success', 5000);
      } catch (error) {
        const aborted = error instanceof Error && error.name === 'AbortError';
        const message = aborted ? 'Export cancelled' : error instanceof Error ? error.message : String(error);
        report({ jobId: job, state: 'error', progress: 0, message });
        addToast(aborted ? message : `Export failed: ${message}`, aborted ? 'info' : 'error', 6000);
      } finally {
        exportJob.set(null);
        renderStatus.set('idle');
        await folder.removeEntry(fileName).catch(() => {});
      }
    })();

    return {
      jobId: job,
      started: true,
      preset: def.id,
      container: resolved.settings.container,
      width: resolved.settings.width,
      height: resolved.settings.height,
      fps: resolved.settings.fps,
      notes: resolved.notes,
      summary: `exporting ${def.name}`
    };
  }
};

export const toolNames = Object.keys(handlers);

export async function runTool(name: string, args: ToolArgs, ctx: ToolContext): Promise<unknown> {
  const handler = handlers[name];
  if (!handler) throw new Error(`Unknown tool "${name}"`);
  return await handler(args ?? {}, ctx);
}
