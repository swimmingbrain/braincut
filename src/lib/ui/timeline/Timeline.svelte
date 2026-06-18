<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import './timeline.css';
  import type { Clip, Id, Label, Project, Sequence, Track, TrackKind } from '$lib/project/types';
  import {
    activeSequence,
    cancelPreview,
    clearSelection,
    commitPreview,
    editSequence,
    mediaById,
    preview,
    selectClips
  } from '$lib/project/store';
  import * as ops from '$lib/project/ops';
  import { clipEnd, createClipFromMedia, createMarker, sequenceDuration } from '$lib/project/defaults';
  import { formatTimecode, nearlyEqual, snapToFrame } from '$lib/project/time';
  import { moveKeyframe, setKeyframe, valueAt } from '$lib/project/keyframes';
  import { id as newId } from '$lib/project/ids';
  import { snap, snapPoints, snapRange, type SnapPoint } from '$lib/editor/snapping';
  import { endDrag, readDrag, type DragPayload } from '$lib/editor/drag';
  import { hasClipboard } from '$lib/editor/clipboard';
  import { toolById } from '$lib/editor/tools';
  import {
    HEADER_W,
    TRANSITION_DROP_PX,
    bandKey,
    bandParam,
    bandValueToY,
    clampZoom,
    clipsInRange,
    cutNear,
    edgeZone,
    firstUnlockedTrack,
    formatBandValue,
    frameTime,
    kindIndex,
    linkedEdges,
    rowAtY,
    rowOf,
    rowsHeight,
    siblingTrack,
    snapTolerance,
    timeToX,
    timelineActions,
    trackRows,
    xToTime,
    yToBandValue,
    zoomAround,
    zoomIn,
    zoomOut,
    zoomToFit,
    type BandKey,
    type Edge,
    type EdgeZone
  } from '$lib/editor/timeline-interactions';
  import {
    activeTool,
    addToast,
    bottomPanelTab,
    contextMenu,
    dialog,
    dragPayload,
    followPlayhead,
    leftPanelTab,
    playhead,
    playing,
    selectedTransitionId,
    selection,
    snapEnabled,
    sourceMedia,
    timelineScroll,
    timelineZoom,
    type MenuItem
  } from '$lib/stores/app';
  import { preferences } from '$lib/stores/preferences';
  import { createEffectInstance, fadeKeyframes, isAudioEffectType, isVideoEffectType } from '$lib/engine/effects/registry';
  import { isAudioTransitionType, transitionDef } from '$lib/engine/transitions/registry';
  import { fillScale, fitScale } from '$lib/engine/transform';
  import { program } from '$lib/engine/session';
  import Ruler from './Ruler.svelte';
  import TrackHeader from './TrackHeader.svelte';
  import TrackLane from './TrackLane.svelte';
  import Playhead from './Playhead.svelte';
  import Scrollbar from './Scrollbar.svelte';

  const SCROLLBAR_H = 10;
  // px a pointer has to travel before a press turns into a drag
  const DRAG_THRESHOLD = 3;

  let root = $state<HTMLDivElement | null>(null);
  let body = $state<HTMLDivElement | null>(null);
  let viewW = $state(0);
  let viewH = $state(0);

  const seq = $derived($activeSequence);
  const rows = $derived(seq ? trackRows(seq) : []);
  const contentH = $derived(rowsHeight(rows));
  const zoom = $derived($timelineZoom);
  const scroll = $derived($timelineScroll);
  const viewEnd = $derived(scroll + viewW / zoom);
  const fps = $derived(seq?.fps ?? 25);
  const duration = $derived(seq ? sequenceDuration(seq) : 0);
  const selectionSet = $derived(new Set($selection));
  const playheadX = $derived(timeToX($playhead, zoom, scroll));
  const tool = $derived($activeTool);
  const cursor = $derived(toolById(tool).cursor);
  const fpsLabel = $derived(fps % 1 === 0 ? String(fps) : fps.toFixed(2));

  interface Ghost {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    name: string;
    kind: 'video' | 'audio';
  }

  let ghosts = $state<Ghost[]>([]);
  let marquee = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let zoomRect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let snapX = $state<number | null>(null);
  let razorX = $state<number | null>(null);
  let tip = $state<{ x: number; y: number; text: string } | null>(null);
  let dropClipId = $state<string | null>(null);
  let dropCut = $state<{ x: number; y: number; h: number } | null>(null);
  let draggingIds = $state<Set<string>>(new Set());
  let selectedMarkerId = $state<string | null>(null);
  let insertMode = $state(false);
  let panning = $state(false);

  type Drag =
    | {
        mode: 'move';
        ids: Id[];
        origins: Map<Id, { trackId: Id; start: number; duration: number; kind: TrackKind; name: string }>;
        primary: Id;
        points: SnapPoint[];
        moves: ops.ClipMove[];
        alt: boolean;
        x: number;
        y: number;
        moved: boolean;
        wasSelected: boolean;
        toggle: boolean;
      }
    | { mode: 'trim'; edges: Edge[]; rolls: Map<Id, { left: Id; right: Id }>; ripple: boolean; time: number; points: SnapPoint[]; x: number; moved: boolean }
    | { mode: 'slip' | 'slide'; clipId: Id; x: number; moved: boolean; speed: number }
    | { mode: 'band'; clipId: Id; key: BandKey; value: number; clipTime: number; height: number; x: number; y: number; moved: boolean }
    | { mode: 'kf'; clipId: Id; key: BandKey; time: number; value: number; duration: number; height: number; x: number; y: number; moved: boolean }
    | { mode: 'transition'; id: Id; zone: EdgeZone; start: number; duration: number; x: number; moved: boolean }
    | { mode: 'marquee'; x: number; y: number; add: boolean; moved: boolean }
    | { mode: 'pan'; clientX: number; clientY: number; scroll: number; top: number }
    | { mode: 'zoom'; x: number; y: number; alt: boolean; moved: boolean }
    | { mode: 'scrub' };

  let drag: Drag | null = null;
  let lastEvent: PointerEvent | null = null;
  let raf = 0;

  function local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    if (!body) return { x: 0, y: 0 };
    const r = body.getBoundingClientRect();
    return { x: e.clientX - r.left - HEADER_W, y: e.clientY - r.top + body.scrollTop };
  }

  function showTip(e: { clientX: number; clientY: number }, text: string) {
    if (!root) return;
    const r = root.getBoundingClientRect();
    tip = { x: Math.min(e.clientX - r.left + 14, r.width - 160), y: e.clientY - r.top + 16, text };
  }

  function tc(time: number): string {
    return formatTimecode(time, fps);
  }

  function signed(delta: number): string {
    return `${delta < 0 ? '-' : '+'}${formatTimecode(Math.abs(delta), fps, { showHours: false })}`;
  }

  function seqIn(d: Project): Sequence | undefined {
    return d.sequences.find((s) => s.id === seq?.id);
  }

  function getMedia(mediaId: Id) {
    return $mediaById.get(mediaId);
  }

  function seek(time: number) {
    program().player.seek(time);
  }

  function snapped(time: number, points: SnapPoint[]): number {
    const tol = $snapEnabled ? snapTolerance(zoom) : 0;
    const r = snap(time, points, tol);
    snapX = r.point ? timeToX(r.time, zoom, scroll) : null;
    return frameTime(r.time, fps);
  }

  function pointsFor(exclude: Id[] = []): SnapPoint[] {
    return seq ? snapPoints(seq, { excludeClipIds: exclude, playhead: $playhead }) : [];
  }

  // the frame a razor or a marker lands on: the sequence grid, or a nearby edge
  function razorTime(x: number): number {
    return snapped(xToTime(x, zoom, scroll), pointsFor());
  }

  function selectedIdsFor(clipId: Id): Id[] {
    if (!seq) return [clipId];
    const current = get(selection);
    const ids = current.includes(clipId) ? current : [clipId];
    const expanded = new Set<Id>();
    for (const cid of ids) for (const linked of ops.linkedClips(seq, cid)) expanded.add(linked.id);
    return [...expanded];
  }

  function capture(e: PointerEvent) {
    body?.setPointerCapture(e.pointerId);
  }

  function onpointerdown(e: PointerEvent) {
    if (!seq || !body) return;
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    const { x, y } = local(e);
    if (x < 0) return;
    root?.focus({ preventScroll: true });
    if (target.tagName === 'INPUT') return;
    e.preventDefault();
    const row = rowAtY(rows, y);
    const clipEl = target.closest<HTMLElement>('[data-clip]');
    const transitionEl = target.closest<HTMLElement>('[data-transition]');
    const kfEl = target.closest<HTMLElement>('[data-kf]');
    const bandEl = target.closest<HTMLElement>('[data-band]');

    if (e.button === 1 || tool === 'hand') {
      drag = { mode: 'pan', clientX: e.clientX, clientY: e.clientY, scroll, top: body.scrollTop };
      panning = true;
      capture(e);
      return;
    }
    if (tool === 'zoom') {
      drag = { mode: 'zoom', x, y, alt: e.altKey, moved: false };
      capture(e);
      return;
    }
    if (tool === 'razor') {
      cutAt(x, row, e.shiftKey);
      return;
    }
    if (tool === 'track-select') {
      trackSelect(x, row, e.shiftKey);
      return;
    }
    if (tool === 'pen') {
      if (clipEl && kfEl) startKeyframe(e, clipEl, kfEl);
      else if (clipEl && bandEl) startBand(e, clipEl, bandEl);
      else if (clipEl) pressClip(e, clipEl);
      return;
    }
    if (transitionEl) {
      pressTransition(e, transitionEl);
      return;
    }
    if (clipEl) {
      if (bandEl && (e.ctrlKey || e.metaKey)) startBand(e, clipEl, bandEl);
      else pressClip(e, clipEl);
      return;
    }
    // empty lane: a marquee, or just a click that clears the selection
    drag = { mode: 'marquee', x, y, add: e.shiftKey, moved: false };
    capture(e);
  }

  function pressClip(e: PointerEvent, clipEl: HTMLElement) {
    if (!seq) return;
    const clipId = clipEl.dataset.clip!;
    const found = ops.findClipById(seq, clipId);
    if (!found) return;
    const { clip, track } = found;
    const rect = clipEl.getBoundingClientRect();
    const zone = edgeZone(e.clientX - rect.left, rect.width);
    const wasSelected = selectionSet.has(clipId);
    const toggle = (e.ctrlKey || e.metaKey) && !e.shiftKey;
    selectedTransitionId.set(null);
    selectedMarkerId = null;
    if (e.shiftKey) selectClips([clipId], 'add');
    else if (toggle) {
      if (!wasSelected) selectClips([clipId], 'add');
    } else if (!wasSelected) selectClips([clipId], 'replace');

    if (track.locked || tool === 'pen') return;
    const { x, y } = local(e);
    if (tool === 'slip' || tool === 'slide') {
      drag = { mode: tool, clipId, x, moved: false, speed: clip.speed };
      capture(e);
      return;
    }
    if (zone !== 'body' && (tool === 'select' || tool === 'ripple' || tool === 'rolling')) {
      startTrim(e, clip, zone, x);
      return;
    }
    const ids = selectedIdsFor(clipId);
    const origins = new Map<Id, { trackId: Id; start: number; duration: number; kind: TrackKind; name: string }>();
    for (const cid of ids) {
      const f = ops.findClipById(seq, cid);
      if (f && !f.track.locked) origins.set(cid, { trackId: f.track.id, start: f.clip.start, duration: f.clip.duration, kind: f.track.kind, name: f.clip.name });
    }
    drag = {
      mode: 'move',
      ids: [...origins.keys()],
      origins,
      primary: clipId,
      points: pointsFor([...origins.keys()]),
      moves: [],
      alt: e.altKey,
      x,
      y,
      moved: false,
      wasSelected,
      toggle
    };
    capture(e);
  }

  function startTrim(e: PointerEvent, clip: Clip, zone: EdgeZone, x: number) {
    if (!seq) return;
    const side = zone === 'head' ? 'head' : 'tail';
    const edges = linkedEdges(seq, clip.id, side);
    const rolls = new Map<Id, { left: Id; right: Id }>();
    if (tool === 'rolling') {
      // a roll needs a neighbour that touches the edge, else it is a plain trim
      for (const edge of edges) {
        const f = ops.findClipById(seq, edge.clipId);
        if (!f) continue;
        const i = f.track.clips.indexOf(f.clip);
        const prev = f.track.clips[i - 1];
        const next = f.track.clips[i + 1];
        if (side === 'head' && prev && nearlyEqual(clipEnd(prev), f.clip.start)) rolls.set(edge.clipId, { left: prev.id, right: f.clip.id });
        if (side === 'tail' && next && nearlyEqual(next.start, clipEnd(f.clip))) rolls.set(edge.clipId, { left: f.clip.id, right: next.id });
      }
    }
    const time = side === 'head' ? clip.start : clipEnd(clip);
    drag = { mode: 'trim', edges, rolls, ripple: tool === 'ripple', time, points: pointsFor(edges.map((ed) => ed.clipId)), x, moved: false };
    capture(e);
  }

  function startBand(e: PointerEvent, clipEl: HTMLElement, bandEl: HTMLElement) {
    if (!seq) return;
    const clipId = clipEl.dataset.clip!;
    const found = ops.findClipById(seq, clipId);
    if (!found || found.track.locked) return;
    const key = bandEl.dataset.band as BandKey;
    const { effectType, param } = bandParam(key);
    const effect = found.clip.effects.find((ef) => ef.type === effectType);
    if (!effect) return;
    const rect = bandEl.closest('svg')!.getBoundingClientRect();
    const { x, y } = local(e);
    const clipTime = frameTime(xToTime(x, zoom, scroll) - found.clip.start, fps);
    const value = valueAt(effect, param, clipTime) as number;
    drag = { mode: 'band', clipId, key, value, clipTime, height: rect.height, x, y, moved: false };
    capture(e);
  }

  function startKeyframe(e: PointerEvent, clipEl: HTMLElement, kfEl: HTMLElement) {
    if (!seq) return;
    const clipId = clipEl.dataset.clip!;
    const found = ops.findClipById(seq, clipId);
    if (!found || found.track.locked) return;
    const key = bandKey(found.clip);
    const { effectType, param } = bandParam(key);
    const effect = found.clip.effects.find((ef) => ef.type === effectType);
    const time = Number(kfEl.dataset.kf);
    const kf = effect?.keyframes[param]?.find((k) => Math.abs(k.time - time) < 1e-6);
    if (!effect || !kf || typeof kf.value !== 'number') return;
    const rect = kfEl.closest('svg')!.getBoundingClientRect();
    const { x, y } = local(e);
    drag = { mode: 'kf', clipId, key, time, value: kf.value, duration: found.clip.duration, height: rect.height, x, y, moved: false };
    capture(e);
  }

  function pressTransition(e: PointerEvent, el: HTMLElement) {
    if (!seq) return;
    const id = el.dataset.transition!;
    const track = seq.tracks.find((t) => t.transitions.some((tr) => tr.id === id));
    const transition = track?.transitions.find((tr) => tr.id === id);
    if (!track || !transition) return;
    clearSelection();
    selectedMarkerId = null;
    selectedTransitionId.set(id);
    if (track.locked) return;
    const rect = el.getBoundingClientRect();
    const zone = edgeZone(e.clientX - rect.left, rect.width);
    drag = { mode: 'transition', id, zone, start: transition.start, duration: transition.duration, x: local(e).x, moved: false };
    capture(e);
  }

  function cutAt(x: number, row: { track: Track } | null, allTracks: boolean) {
    if (!seq) return;
    const time = razorTime(x);
    if (allTracks) {
      editSequence('split clips', (d) => ops.splitClipsAt(d, time, 'all-unlocked'));
      return;
    }
    if (!row || row.track.locked) return;
    const clip = ops.clipAt(row.track, time);
    if (!clip) return;
    const ids = ops.linkedClips(seq, clip.id).map((c) => c.id);
    editSequence('split clip', (d) => ops.splitClipsAt(d, time, ids));
  }

  function trackSelect(x: number, row: { track: Track } | null, allTracks: boolean) {
    if (!seq) return;
    const time = xToTime(x, zoom, scroll);
    const tracks = allTracks ? seq.tracks : row ? [row.track] : [];
    const ids: Id[] = [];
    for (const track of tracks) for (const clip of track.clips) if (clipEnd(clip) > time) ids.push(clip.id);
    selectedTransitionId.set(null);
    selectClips(ids, 'replace');
  }

  function onpointermove(e: PointerEvent) {
    lastEvent = e;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame() {
    raf = 0;
    const e = lastEvent;
    if (!e || !seq || !body) return;
    const { x, y } = local(e);
    if (!drag) {
      if (tool === 'razor' && x >= 0) razorX = timeToX(razorTime(x), zoom, scroll);
      else razorX = null;
      return;
    }
    switch (drag.mode) {
      case 'move':
        moveFrame(drag, e, x, y);
        break;
      case 'trim':
        trimFrame(drag, e, x);
        break;
      case 'slip':
      case 'slide':
        slipFrame(drag, e, x);
        break;
      case 'band':
        bandFrame(drag, e, y);
        break;
      case 'kf':
        keyframeFrame(drag, e, x, y);
        break;
      case 'transition':
        transitionFrame(drag, e, x);
        break;
      case 'marquee': {
        if (!drag.moved && Math.abs(x - drag.x) < DRAG_THRESHOLD && Math.abs(y - drag.y) < DRAG_THRESHOLD) return;
        drag.moved = true;
        marquee = rect(drag.x, drag.y, x, y);
        break;
      }
      case 'zoom': {
        if (!drag.moved && Math.abs(x - drag.x) < DRAG_THRESHOLD) return;
        drag.moved = true;
        zoomRect = rect(drag.x, drag.y, x, y);
        break;
      }
      case 'pan':
        timelineScroll.set(Math.max(0, drag.scroll - (e.clientX - drag.clientX) / zoom));
        body.scrollTop = drag.top - (e.clientY - drag.clientY);
        break;
      case 'scrub':
        seek(frameTime(xToTime(x, zoom, scroll), fps));
        break;
    }
  }

  function rect(x0: number, y0: number, x1: number, y1: number) {
    return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  }

  function moveFrame(d: Extract<Drag, { mode: 'move' }>, e: PointerEvent, x: number, y: number) {
    if (!seq) return;
    if (!d.moved && Math.abs(x - d.x) < DRAG_THRESHOLD && Math.abs(y - d.y) < DRAG_THRESHOLD) return;
    d.moved = true;
    draggingIds = new Set(d.ids);
    const primary = d.origins.get(d.primary);
    if (!primary) return;
    const dt = (x - d.x) / zoom;
    const wanted = Math.max(0, primary.start + dt);
    const tol = $snapEnabled ? snapTolerance(zoom) : 0;
    const sr = snapRange(wanted, primary.duration, d.points, tol);
    const start = Math.max(0, frameTime(sr.start, fps));
    snapX = sr.point ? timeToX(sr.point.time, zoom, scroll) : null;
    const delta = start - primary.start;
    const row = rowAtY(rows, y);
    const offset = row && row.track.kind === primary.kind ? kindIndex(seq, row.track.id) - kindIndex(seq, primary.trackId) : 0;
    const moves: ops.ClipMove[] = [];
    const next: Ghost[] = [];
    for (const [cid, origin] of d.origins) {
      const target = siblingTrack(seq, origin.trackId, offset);
      const r = target && rowOf(rows, target.id);
      if (!target || !r) continue;
      const s = Math.max(0, frameTime(origin.start + delta, fps));
      moves.push({ clipId: cid, trackId: target.id, start: s });
      next.push({ id: cid, x: timeToX(s, zoom, scroll), y: r.top, w: origin.duration * zoom, h: r.height, name: origin.name, kind: origin.kind });
    }
    d.moves = moves;
    ghosts = next;
    insertMode = e.ctrlKey || e.metaKey;
    const mode = insertMode ? 'insert' : 'overwrite';
    showTip(e, `${tc(start)}  ${signed(delta)}  ${d.alt ? 'duplicate' : mode}`);
  }

  function trimFrame(d: Extract<Drag, { mode: 'trim' }>, e: PointerEvent, x: number) {
    if (!seq) return;
    if (!d.moved && Math.abs(x - d.x) < DRAG_THRESHOLD) return;
    d.moved = true;
    const target = snapped(d.time + (x - d.x) / zoom, d.points);
    const ripple = d.ripple;
    const edges = d.edges;
    const rolls = d.rolls;
    cancelPreview();
    preview((p) => {
      const s = seqIn(p);
      if (!s) return;
      for (const edge of edges) {
        const roll = rolls.get(edge.clipId);
        if (roll) ops.rollEdit(s, roll.left, roll.right, target, { getMedia });
        else if (edge.edge === 'head') ops.trimClipStart(s, edge.clipId, target, { ripple, getMedia });
        else ops.trimClipEnd(s, edge.clipId, target, { ripple, getMedia });
      }
    });
    const after = ops.findClipById(get(activeSequence)!, edges[0].clipId)?.clip;
    if (!after) return;
    const now = edges[0].edge === 'head' ? after.start : clipEnd(after);
    showTip(e, `${signed(now - d.time)}  ${tc(after.duration)}`);
  }

  function slipFrame(d: Extract<Drag, { mode: 'slip' | 'slide' }>, e: PointerEvent, x: number) {
    if (!d.moved && Math.abs(x - d.x) < DRAG_THRESHOLD) return;
    d.moved = true;
    const dt = snapToFrame((x - d.x) / zoom, fps);
    const clipId = d.clipId;
    const mode = d.mode;
    const speed = d.speed;
    cancelPreview();
    preview((p) => {
      const s = seqIn(p);
      if (!s) return;
      // slipping drags the footage, so the source moves against the pointer
      if (mode === 'slip') ops.slipClip(s, clipId, -dt * speed, { getMedia });
      else ops.slideClip(s, clipId, dt, { getMedia });
    });
    const after = ops.findClipById(get(activeSequence)!, clipId)?.clip;
    if (!after) return;
    if (mode === 'slip') showTip(e, `in ${tc(after.in)}  out ${tc(after.in + after.duration * after.speed)}`);
    else showTip(e, `${tc(after.start)}  ${signed(dt)}`);
  }

  function bandFrame(d: Extract<Drag, { mode: 'band' }>, e: PointerEvent, y: number) {
    if (!d.moved && Math.abs(y - d.y) < DRAG_THRESHOLD) return;
    d.moved = true;
    const value = yToBandValue(d.key, bandValueToY(d.key, d.value, d.height) + (y - d.y), d.height);
    const { effectType, param } = bandParam(d.key);
    const clipId = d.clipId;
    const clipTime = d.clipTime;
    cancelPreview();
    preview((p) => {
      const s = seqIn(p);
      const clip = s && ops.findClipById(s, clipId)?.clip;
      const effect = clip?.effects.find((ef) => ef.type === effectType);
      if (!effect) return;
      if (effect.keyframes[param]?.length) setKeyframe(effect, param, clipTime, value);
      else effect.params[param] = value;
    });
    showTip(e, formatBandValue(d.key, value));
  }

  function keyframeFrame(d: Extract<Drag, { mode: 'kf' }>, e: PointerEvent, x: number, y: number) {
    if (!d.moved && Math.abs(x - d.x) < DRAG_THRESHOLD && Math.abs(y - d.y) < DRAG_THRESHOLD) return;
    d.moved = true;
    const time = Math.min(d.duration, frameTime(d.time + (x - d.x) / zoom, fps));
    const value = yToBandValue(d.key, bandValueToY(d.key, d.value, d.height) + (y - d.y), d.height);
    const { effectType, param } = bandParam(d.key);
    const clipId = d.clipId;
    const from = d.time;
    cancelPreview();
    preview((p) => {
      const s = seqIn(p);
      const clip = s && ops.findClipById(s, clipId)?.clip;
      const effect = clip?.effects.find((ef) => ef.type === effectType);
      if (!effect) return;
      moveKeyframe(effect, param, from, time);
      setKeyframe(effect, param, time, value);
    });
    showTip(e, `${tc(time)}  ${formatBandValue(d.key, value)}`);
  }

  function transitionFrame(d: Extract<Drag, { mode: 'transition' }>, e: PointerEvent, x: number) {
    if (!d.moved && Math.abs(x - d.x) < DRAG_THRESHOLD) return;
    d.moved = true;
    const dt = frameTime(d.start + (x - d.x) / zoom, fps) - d.start;
    let start = d.start;
    let length = d.duration;
    if (d.zone === 'head') {
      start = d.start + dt;
      length = d.duration - dt;
    } else if (d.zone === 'tail') length = d.duration + dt;
    else start = d.start + dt;
    const id = d.id;
    cancelPreview();
    preview((p) => {
      const s = seqIn(p);
      if (s) ops.resizeTransition(s, id, start, length);
    });
    const after = get(activeSequence)?.tracks.flatMap((t) => t.transitions).find((t) => t.id === id);
    if (after) showTip(e, `${tc(after.duration)}`);
  }

  function onpointerup(e: PointerEvent) {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      frame();
    }
    const d = drag;
    drag = null;
    lastEvent = null;
    if (!d || !seq) {
      clearOverlays();
      return;
    }
    const { x, y } = local(e);
    switch (d.mode) {
      case 'move':
        finishMove(d);
        break;
      case 'trim':
        if (d.moved) commitPreview(d.rolls.size ? 'roll edit' : d.ripple ? 'ripple trim' : 'trim clip');
        break;
      case 'slip':
      case 'slide':
        if (d.moved) commitPreview(d.mode === 'slip' ? 'slip clip' : 'slide clip');
        break;
      case 'band':
        if (d.moved) commitPreview(d.key === 'opacity' ? 'change opacity' : 'change volume');
        else if (tool === 'pen') addKeyframe(d.clipId, d.key, d.clipTime);
        break;
      case 'kf':
        if (d.moved) commitPreview('move keyframe');
        break;
      case 'transition':
        if (d.moved) commitPreview(d.zone === 'body' ? 'move transition' : 'resize transition');
        break;
      case 'marquee':
        if (d.moved) selectInRect(rect(d.x, d.y, x, y), d.add);
        else if (!d.add) {
          clearSelection();
          selectedTransitionId.set(null);
          selectedMarkerId = null;
        }
        break;
      case 'zoom':
        finishZoom(d, x);
        break;
    }
    clearOverlays();
  }

  function clearOverlays() {
    ghosts = [];
    marquee = null;
    zoomRect = null;
    snapX = null;
    tip = null;
    insertMode = false;
    panning = false;
    if (draggingIds.size) draggingIds = new Set();
  }

  function finishMove(d: Extract<Drag, { mode: 'move' }>) {
    if (!seq) return;
    if (!d.moved) {
      // a plain press on an already selected clip narrows the selection to it,
      // a ctrl press on one takes it out
      if (d.toggle && d.wasSelected) selectClips([d.primary], 'toggle');
      else if (!d.toggle && d.wasSelected) selectClips([d.primary], 'replace');
      return;
    }
    const moves = d.moves;
    if (moves.length === 0) return;
    const mode = insertMode ? 'insert' : 'overwrite';
    if (d.alt) {
      let placed: Id[] = [];
      editSequence('duplicate clips', (s) => {
        const linkIds = new Map<Id, Id>();
        const placements: ops.Placement[] = [];
        for (const m of moves) {
          const source = ops.findClipById(s, m.clipId)?.clip;
          if (!source) continue;
          const clip = JSON.parse(JSON.stringify(source)) as Clip;
          clip.id = newId();
          clip.start = m.start;
          if (clip.linkId) {
            const mapped = linkIds.get(clip.linkId) ?? newId();
            linkIds.set(clip.linkId, mapped);
            clip.linkId = mapped;
          }
          for (const effect of clip.effects) effect.id = newId();
          placements.push({ trackId: m.trackId, clip });
        }
        placed = ops.placeClips(s, placements, mode);
      });
      if (placed.length) selection.set(placed);
      return;
    }
    let ok = true;
    editSequence('move clips', (s) => {
      ok = ops.moveClips(s, moves, mode, { keepLinked: false });
    });
    if (!ok) addToast('The clips can\'t go there', 'warning');
  }

  function finishZoom(d: Extract<Drag, { mode: 'zoom' }>, x: number) {
    if (!d.moved || Math.abs(x - d.x) < 4) {
      const next = zoomAround(zoom, scroll, zoom * (d.alt ? 0.5 : 2), d.x);
      timelineZoom.set(next.zoom);
      timelineScroll.set(next.scroll);
      return;
    }
    const from = xToTime(Math.min(d.x, x), zoom, scroll);
    const to = xToTime(Math.max(d.x, x), zoom, scroll);
    timelineZoom.set(clampZoom(viewW / Math.max(0.01, to - from)));
    timelineScroll.set(from);
  }

  function selectInRect(r: { x: number; y: number; w: number; h: number }, add: boolean) {
    if (!seq) return;
    const from = xToTime(r.x, zoom, scroll);
    const to = xToTime(r.x + r.w, zoom, scroll);
    const ids: Id[] = [];
    for (const row of rows) {
      if (row.top + row.height <= r.y || row.top >= r.y + r.h) continue;
      for (const clip of clipsInRange(row.track.clips, from, to)) ids.push(clip.id);
    }
    if (ids.length === 0 && !add) clearSelection();
    else selectClips(ids, add ? 'add' : 'replace');
  }

  function addKeyframe(clipId: Id, key: BandKey, clipTime: number) {
    const { effectType, param } = bandParam(key);
    editSequence('add keyframe', (s) => {
      const clip = ops.findClipById(s, clipId)?.clip;
      const effect = clip?.effects.find((ef) => ef.type === effectType);
      if (!effect) return;
      setKeyframe(effect, param, clipTime, valueAt(effect, param, clipTime));
    });
  }

  function onplayheaddown(e: PointerEvent) {
    if (e.button !== 0 || !body) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { mode: 'scrub' };
    capture(e);
  }

  function onwheel(e: WheelEvent) {
    if (!body) return;
    // some browsers report lines instead of pixels
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const r = body.getBoundingClientRect();
      const anchor = Math.max(0, e.clientX - r.left - HEADER_W);
      const factor = Math.exp(-e.deltaY * unit * 0.0025);
      const next = zoomAround(zoom, scroll, zoom * factor, anchor);
      timelineZoom.set(next.zoom);
      timelineScroll.set(next.scroll);
      return;
    }
    const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (!horizontal) return;
    e.preventDefault();
    const delta = (e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX) * unit;
    timelineScroll.set(Math.max(0, scroll + delta / zoom));
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (drag) {
        cancelPreview();
        drag = null;
        clearOverlays();
        return;
      }
      clearSelection();
      selectedTransitionId.set(null);
      selectedMarkerId = null;
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (selectedMarkerId && $selection.length === 0 && !$selectedTransitionId) {
        const id = selectedMarkerId;
        selectedMarkerId = null;
        editSequence('delete marker', (s) => ops.removeMarker(s, id));
      } else if (e.shiftKey) timelineActions.rippleDeleteSelection();
      else timelineActions.deleteSelection();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'a' && !e.shiftKey) {
      e.preventDefault();
      timelineActions.selectAll();
    }
  }

  // context menus

  const labels: Label[] = ['none', 'violet', 'iris', 'caribbean', 'lavender', 'cerulean', 'forest', 'rose', 'mango', 'purple', 'blue', 'teal', 'magenta', 'tan', 'green', 'brown', 'yellow'];

  function labelName(label: Label): string {
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function withSelected(label: string, fn: (s: Sequence, clip: Clip) => void) {
    const ids = [...selectionSet];
    editSequence(label, (s) => {
      for (const cid of ids) {
        const clip = ops.findClipById(s, cid)?.clip;
        if (clip) fn(s, clip);
      }
    });
  }

  function setScale(label: string, pick: typeof fitScale) {
    withSelected(label, (s, clip) => {
      if (clip.kind === 'audio' || !clip.mediaId) return;
      const media = getMedia(clip.mediaId);
      const transform = clip.effects.find((ef) => ef.type === 'transform');
      if (!media || !transform) return;
      const scale = Math.round(pick(media, s) * 100) / 100;
      transform.params.scale = scale;
      transform.params.scaleY = scale;
      transform.params.uniformScale = true;
    });
  }

  function fade(direction: 'in' | 'out') {
    withSelected(direction === 'in' ? 'fade in' : 'fade out', (_, clip) => {
      if (clip.kind !== 'audio') return;
      const volume = clip.effects.find((ef) => ef.type === 'volume');
      if (!volume) return;
      const added = fadeKeyframes(direction, clip.duration);
      const window = { from: added[0].time, to: added[added.length - 1].time };
      const kept = (volume.keyframes.level ?? []).filter((k) => k.time < window.from - 1e-6 || k.time > window.to + 1e-6);
      volume.keyframes.level = [...kept, ...added].sort((a, b) => a.time - b.time);
    });
  }

  function clipMenu(clip: Clip, track: Track): MenuItem[] {
    const ids = [...selectionSet];
    const hasFx = clip.effects.some((ef) => !ef.fixed);
    const visual = clip.kind !== 'audio';
    const kind: TrackKind = track.kind;
    return [
      { label: 'Cut', shortcut: 'Ctrl+X', action: () => timelineActions.cutSelection() },
      { label: 'Copy', shortcut: 'Ctrl+C', action: () => timelineActions.copySelection() },
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !$hasClipboard, action: () => timelineActions.pasteAtPlayhead(track.id) },
      { label: '', separator: true },
      { label: 'Delete', shortcut: 'Del', action: () => timelineActions.deleteSelection() },
      { label: 'Ripple Delete', shortcut: 'Shift+Del', action: () => timelineActions.rippleDeleteSelection() },
      { label: 'Split at Playhead', shortcut: 'Ctrl+K', action: () => timelineActions.splitAtPlayhead() },
      { label: '', separator: true },
      { label: clip.linkId ? 'Unlink' : 'Link', shortcut: 'Ctrl+L', disabled: !clip.linkId && ids.length < 2, action: () => timelineActions.linkSelection() },
      { label: clip.enabled ? 'Disable' : 'Enable', shortcut: 'Shift+E', action: () => timelineActions.toggleEnabled() },
      { label: 'Speed/Duration…', shortcut: 'Ctrl+R', action: () => dialog.set({ kind: 'speed', clipIds: ids }) },
      { label: 'Rename…', action: () => dialog.set({ kind: 'rename', target: 'clip', id: clip.id }) },
      {
        label: 'Label',
        children: labels.map((label) => ({
          label: labelName(label),
          checked: clip.label === label,
          action: () => editSequence('set label', (s) => ops.setLabel(s, ids, label))
        }))
      },
      { label: '', separator: true },
      ...(visual && clip.mediaId
        ? [
            { label: 'Set to Frame Size', action: () => setScale('set to frame size', fitScale) },
            { label: 'Scale to Fill', action: () => setScale('scale to fill', fillScale) }
          ]
        : []),
      ...(clip.kind === 'audio'
        ? [
            { label: 'Fade In', action: () => fade('in') },
            { label: 'Fade Out', action: () => fade('out') }
          ]
        : []),
      { label: 'Add Default Transition', shortcut: kind === 'video' ? 'Ctrl+D' : 'Ctrl+Shift+D', action: () => timelineActions.addDefaultTransition(kind) },
      {
        label: 'Remove Effects',
        disabled: !hasFx,
        action: () => withSelected('remove effects', (_, c) => {
          c.effects = c.effects.filter((ef) => ef.fixed);
        })
      },
      { label: '', separator: true },
      {
        label: 'Reveal in Project',
        disabled: !clip.mediaId,
        action: () => {
          bottomPanelTab.set('project');
          window.dispatchEvent(new CustomEvent('braincut:reveal-media', { detail: { mediaId: clip.mediaId } }));
        }
      },
      { label: 'Export Frame…', shortcut: 'Ctrl+Shift+E', action: () => window.dispatchEvent(new CustomEvent('braincut:export-frame')) }
    ];
  }

  function laneMenu(track: Track | null, time: number): MenuItem[] {
    const gap = track ? ops.gapsOnTrack(track).some((g) => g.start <= time && g.end > time) : false;
    return [
      { label: 'Paste', shortcut: 'Ctrl+V', disabled: !$hasClipboard, action: () => timelineActions.pasteAtPlayhead(track?.id) },
      { label: 'Add Marker', shortcut: 'M', action: () => editSequence('add marker', (s) => ops.addMarker(s, createMarker(frameTime(time, fps)))) },
      {
        label: 'Close Gap',
        disabled: !gap || !track || track.locked,
        action: () => {
          if (track) editSequence('close gap', (s) => ops.closeGap(s, track.id, time));
        }
      },
      { label: '', separator: true },
      { label: 'Add Video Track', action: () => editSequence('add video track', (s) => ops.addTrack(s, 'video')) },
      { label: 'Add Audio Track', action: () => editSequence('add audio track', (s) => ops.addTrack(s, 'audio')) }
    ];
  }

  function transitionMenu(id: Id): MenuItem[] {
    const align = (alignment: ops.TransitionAlignment) => editSequence('align transition', (s) => ops.setTransitionAlignment(s, id, alignment));
    return [
      {
        label: 'Alignment',
        children: [
          { label: 'Start at Cut', action: () => align('start') },
          { label: 'Center at Cut', action: () => align('center') },
          { label: 'End at Cut', action: () => align('end') }
        ]
      },
      { label: '', separator: true },
      {
        label: 'Delete',
        danger: true,
        action: () => {
          editSequence('delete transition', (s) => ops.removeTransition(s, id));
          selectedTransitionId.set(null);
        }
      }
    ];
  }

  function oncontextmenu(e: MouseEvent) {
    if (!seq) return;
    const { x, y } = local(e);
    if (x < 0) return;
    e.preventDefault();
    const target = e.target as HTMLElement;
    const clipEl = target.closest<HTMLElement>('[data-clip]');
    const transitionEl = target.closest<HTMLElement>('[data-transition]');
    let items: MenuItem[];
    if (transitionEl) {
      const id = transitionEl.dataset.transition!;
      selectedTransitionId.set(id);
      clearSelection();
      items = transitionMenu(id);
    } else if (clipEl) {
      const found = ops.findClipById(seq, clipEl.dataset.clip!);
      if (!found) return;
      if (!selectionSet.has(found.clip.id)) selectClips([found.clip.id], 'replace');
      items = clipMenu(found.clip, found.track);
    } else {
      items = laneMenu(rowAtY(rows, y)?.track ?? null, xToTime(x, zoom, scroll));
    }
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }

  function ondblclick(e: MouseEvent) {
    if (!seq) return;
    const clipEl = (e.target as HTMLElement).closest<HTMLElement>('[data-clip]');
    if (!clipEl) return;
    const clip = ops.findClipById(seq, clipEl.dataset.clip!)?.clip;
    if (!clip?.mediaId) return;
    // like every desktop nle: a double-click loads the clip into the source monitor
    sourceMedia.set({ mediaId: clip.mediaId, in: clip.in, out: clip.in + clip.duration * clip.speed, time: clip.in });
    leftPanelTab.set('source');
  }

  // drops from the project panel, the source monitor, the effects panel

  interface DropPlan {
    placements: ops.Placement[];
  }

  function planMedia(payload: Extract<DragPayload, { kind: 'media' | 'source' }>, row: { track: Track } | null, time: number): DropPlan {
    if (!seq) return { placements: [] };
    const prefs = $preferences;
    const placements: ops.Placement[] = [];
    let cursor = time;
    const items = payload.kind === 'media'
      ? payload.mediaIds.map((mid) => ({ media: getMedia(mid), opts: {} as { in?: number; duration?: number } }))
      : [{ media: getMedia(payload.mediaId), opts: { in: payload.in, duration: payload.out - payload.in } }];
    for (const { media, opts } of items) {
      if (!media) continue;
      const clips = createClipFromMedia(media, cursor, { ...opts, fps, stillDuration: prefs.stillImageDuration });
      const videoTrack = row?.track.kind === 'video' && !row.track.locked ? row.track : firstUnlockedTrack(seq, 'video');
      const audioTrack = row?.track.kind === 'audio' && !row.track.locked ? row.track : firstUnlockedTrack(seq, 'audio');
      let length = 0;
      if (clips.video && videoTrack) {
        placements.push({ trackId: videoTrack.id, clip: clips.video });
        length = clips.video.duration;
      }
      if (clips.audio && audioTrack) {
        placements.push({ trackId: audioTrack.id, clip: clips.audio });
        length = Math.max(length, clips.audio.duration);
      }
      cursor += length;
    }
    return { placements };
  }

  function dropTime(x: number): number {
    return snapped(xToTime(x, zoom, scroll), pointsFor());
  }

  function ondragover(e: DragEvent) {
    const payload = $dragPayload;
    if (!payload || !seq || !body) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    const { x, y } = local(e);
    const row = rowAtY(rows, y);
    const time = dropTime(x);
    dropClipId = null;
    dropCut = null;
    if (payload.kind === 'media' || payload.kind === 'source') {
      const plan = planMedia(payload, row, time);
      // keyed by position, not clip id: the plan makes fresh ids on every move
      ghosts = plan.placements.flatMap((p, i) => {
        const r = rowOf(rows, p.trackId);
        if (!r) return [];
        return [{ id: `drop-${i}`, x: timeToX(p.clip.start, zoom, scroll), y: r.top, w: p.clip.duration * zoom, h: r.height, name: p.clip.name, kind: p.clip.kind === 'audio' ? 'audio' : 'video' }];
      });
      insertMode = e.ctrlKey || e.metaKey;
      return;
    }
    ghosts = [];
    snapX = null;
    if (payload.kind === 'effect') {
      const clip = row ? ops.clipAt(row.track, xToTime(x, zoom, scroll)) : null;
      dropClipId = clip && effectFits(payload.type, clip) ? clip.id : null;
      return;
    }
    if (row && !row.track.locked && (row.track.kind === 'audio') === isAudioTransitionType(payload.type)) {
      const cut = cutNear(row.track, xToTime(x, zoom, scroll), TRANSITION_DROP_PX / zoom);
      if (cut) dropCut = { x: timeToX(cut.cut, zoom, scroll), y: row.top, h: row.height };
    }
  }

  function effectFits(type: string, clip: Clip): boolean {
    return clip.kind === 'audio' ? isAudioEffectType(type) : isVideoEffectType(type);
  }

  function ondragleave(e: DragEvent) {
    if (body && e.relatedTarget instanceof Node && body.contains(e.relatedTarget)) return;
    clearDrop();
  }

  function clearDrop() {
    ghosts = [];
    snapX = null;
    dropClipId = null;
    dropCut = null;
    insertMode = false;
  }

  function ondrop(e: DragEvent) {
    const payload = readDrag(e) ?? $dragPayload;
    if (!payload || !seq) return;
    e.preventDefault();
    const { x, y } = local(e);
    const row = rowAtY(rows, y);
    const time = dropTime(x);
    const rawTime = xToTime(x, zoom, scroll);
    if (payload.kind === 'media' || payload.kind === 'source') {
      const plan = planMedia(payload, row, time);
      const mode = e.ctrlKey || e.metaKey ? 'insert' : 'overwrite';
      let placed: Id[] = [];
      if (plan.placements.length) {
        editSequence('add clips', (s) => {
          placed = ops.placeClips(s, plan.placements, mode);
        });
      }
      if (placed.length) selection.set(placed);
      else addToast('No unlocked track to put the clip on', 'warning');
    } else if (payload.kind === 'effect') {
      const clip = row ? ops.clipAt(row.track, rawTime) : null;
      if (!clip) addToast('Drop the effect on a clip', 'info');
      else if (!effectFits(payload.type, clip)) {
        addToast(clip.kind === 'audio' ? 'Audio clips take audio effects' : 'Video effects go on video clips', 'warning');
      } else {
        const type = payload.type;
        const clipId = clip.id;
        editSequence('add effect', (s) => {
          ops.findClipById(s, clipId)?.clip.effects.push(createEffectInstance(type));
        });
        selectClips([clipId], 'replace');
      }
    } else {
      dropTransition(payload.type, row, rawTime);
    }
    clearDrop();
    endDrag();
  }

  function dropTransition(type: string, row: { track: Track } | null, time: number) {
    if (!seq || !row) return;
    const def = transitionDef(type);
    if (!def) return;
    if ((row.track.kind === 'audio') !== isAudioTransitionType(type)) {
      addToast(def.kind === 'audio' ? 'Audio transitions go on audio tracks' : 'Video transitions go on video tracks', 'warning');
      return;
    }
    const cut = cutNear(row.track, time, TRANSITION_DROP_PX / zoom);
    if (!cut) {
      addToast('Drop the transition on a cut or a clip edge', 'info');
      return;
    }
    // which side of the cut it lands on picks the alignment
    let alignment: ops.TransitionAlignment | undefined;
    if (cut.leftClipId && cut.rightClipId) {
      const side = (time - cut.cut) * zoom;
      alignment = Math.abs(side) < 3 ? 'center' : side < 0 ? 'end' : 'start';
    }
    const duration = Math.max(0.04, $preferences.defaultTransitionDuration);
    const trackId = row.track.id;
    let created: Id | null = null;
    editSequence('add transition', (s) => {
      created = ops.addTransition(s, trackId, { type, ...cut, duration, alignment });
    });
    if (created) {
      clearSelection();
      selectedTransitionId.set(created);
    }
  }

  // markers and context helpers for the ruler

  function onselectmarker(id: string | null) {
    selectedMarkerId = id;
    if (id) {
      clearSelection();
      selectedTransitionId.set(null);
    }
  }

  function onscrollbar(nextScroll: number, nextZoom: number) {
    timelineZoom.set(clampZoom(nextZoom));
    timelineScroll.set(Math.max(0, nextScroll));
  }

  // the view jumps a page when the playhead runs off the right edge, like a
  // desktop nle, so playback never fights a smooth scroll
  $effect(() => {
    if (!$playing || !$followPlayhead || viewW <= 0) return;
    const t = $playhead;
    if (t > viewEnd || t < scroll) timelineScroll.set(Math.max(0, t));
  });

  onMount(() => {
    if (!body || !root) return;
    const observer = new ResizeObserver(() => {
      if (!body) return;
      viewW = Math.max(0, body.clientWidth - HEADER_W);
      viewH = body.clientHeight;
    });
    observer.observe(body);
    viewW = Math.max(0, body.clientWidth - HEADER_W);
    viewH = body.clientHeight;
    // ctrl+wheel must stop the browser zoom, which needs a non-passive listener
    root.addEventListener('wheel', onwheel, { passive: false });
    const zoomInHandler = () => zoomIn(viewW);
    const zoomOutHandler = () => zoomOut(viewW);
    const zoomFitHandler = () => zoomToFit(viewW);
    window.addEventListener('braincut:zoom-in', zoomInHandler);
    window.addEventListener('braincut:zoom-out', zoomOutHandler);
    window.addEventListener('braincut:zoom-fit', zoomFitHandler);
    return () => {
      observer.disconnect();
      root?.removeEventListener('wheel', onwheel);
      window.removeEventListener('braincut:zoom-in', zoomInHandler);
      window.removeEventListener('braincut:zoom-out', zoomOutHandler);
      window.removeEventListener('braincut:zoom-fit', zoomFitHandler);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  // a transition that vanished with its cut must not stay selected
  $effect(() => {
    const id = $selectedTransitionId;
    if (!id || !seq) return;
    if (!seq.tracks.some((t) => t.transitions.some((tr) => tr.id === id))) selectedTransitionId.set(null);
  });

  const toolClass = $derived(`tool-${tool}`);
  const playheadVisible = $derived(playheadX >= 0 && playheadX <= viewW);
  const bodyCursor = $derived(panning ? 'grabbing' : cursor);
</script>

<!-- the timeline is one big control: it takes focus for its own keys -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="timeline {toolClass}"
  bind:this={root}
  tabindex="0"
  role="application"
  aria-label="Timeline"
  style="cursor: {bodyCursor}"
  {onkeydown}>
  {#if seq}
    <div class="top">
      <div class="corner">
        <span class="size">{seq.width}&#215;{seq.height}</span>
        <span class="fps">{fpsLabel} fps</span>
      </div>
      <div class="ruler-wrap">
        <Ruler {seq} {zoom} {scroll} width={viewW} {selectedMarkerId} onseek={seek} {onselectmarker} />
      </div>
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="body"
      bind:this={body}
      role="presentation"
      {onpointerdown}
      {onpointermove}
      {onpointerup}
      onpointercancel={onpointerup}
      onpointerleave={() => (razorX = null)}
      {oncontextmenu}
      {ondblclick}
      {ondragover}
      {ondragleave}
      {ondrop}>
      <div class="rows" style="min-height: {Math.max(contentH, viewH)}px">
        {#each rows as row (row.track.id)}
          <div class="row" style="height: {row.height}px">
            <TrackHeader track={row.track} {seq} />
            <TrackLane
              track={row.track}
              {zoom}
              {scroll}
              viewStart={scroll}
              {viewEnd}
              selection={selectionSet}
              selectedTransitionId={$selectedTransitionId}
              {draggingIds}
              {dropClipId}
              media={$mediaById}
              showThumbs={$preferences.showThumbnails}
              showWaves={$preferences.showWaveforms} />
          </div>
        {/each}
        <div class="filler"><div class="filler-header"></div></div>
      </div>

      <div class="overlay" style="height: {Math.max(contentH, viewH)}px">
        {#each ghosts as ghost (ghost.id)}
          <div
            class="ghost {ghost.kind}"
            class:insert={insertMode}
            style="transform: translate({ghost.x}px, {ghost.y}px); width: {Math.max(2, ghost.w)}px; height: {ghost.h}px">
            <span>{ghost.name}</span>
          </div>
        {/each}
        {#if dropCut}
          <div class="drop-cut" style="transform: translate({dropCut.x - 4}px, {dropCut.y}px); height: {dropCut.h}px"></div>
        {/if}
        {#if snapX !== null}
          <div class="guide" style="transform: translateX({snapX}px)"></div>
        {/if}
        {#if razorX !== null}
          <div class="razor" style="transform: translateX({razorX}px)"></div>
        {/if}
        {#if marquee}
          <div class="marquee" style="transform: translate({marquee.x}px, {marquee.y}px); width: {marquee.w}px; height: {marquee.h}px"></div>
        {/if}
        {#if zoomRect}
          <div class="marquee zoom" style="transform: translate({zoomRect.x}px, {zoomRect.y}px); width: {zoomRect.w}px; height: {zoomRect.h}px"></div>
        {/if}
      </div>
    </div>

    <div class="bottom" style="height: {SCROLLBAR_H}px">
      <div class="corner-bottom"></div>
      <div class="scrollbar-wrap">
        <Scrollbar {scroll} {zoom} viewWidth={viewW} {duration} onchange={onscrollbar} />
      </div>
    </div>

    <div class="playhead-layer" class:off={!playheadVisible} style="bottom: {SCROLLBAR_H}px">
      <Playhead x={HEADER_W + playheadX} onpointerdown={onplayheaddown} />
    </div>

    {#if tip}
      <div class="tl-tip" style="left: {tip.x}px; top: {tip.y}px">{tip.text}</div>
    {/if}
  {:else}
    <div class="empty">No sequence open</div>
  {/if}
</div>

<style>
  .timeline {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    outline: none;
    overflow: hidden;
  }

  .timeline:focus-visible {
    box-shadow: inset 0 0 0 1px var(--border-focus);
  }

  .top {
    display: flex;
    flex-shrink: 0;
    height: var(--ruler-h);
  }

  .corner {
    width: var(--track-header-w);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-surface);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    user-select: none;
  }

  .corner .size {
    color: var(--text-secondary);
  }

  .ruler-wrap {
    flex: 1;
    min-width: 0;
  }

  .body {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--bg-deep);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: flex;
    flex-shrink: 0;
  }

  .filler {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  .filler-header {
    width: var(--track-header-w);
    flex-shrink: 0;
    background: var(--bg-surface);
    border-right: 1px solid var(--border);
  }

  .overlay {
    position: absolute;
    top: 0;
    left: var(--track-header-w);
    right: 0;
    pointer-events: none;
    z-index: 10;
    overflow: hidden;
  }

  .ghost {
    position: absolute;
    top: 0;
    left: 0;
    border: 1px dashed var(--text-secondary);
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
    padding: 0 5px;
    font-family: var(--font-editor);
    font-size: 10.5px;
    line-height: 14px;
    color: var(--text-primary);
    white-space: nowrap;
    will-change: transform;
  }

  .ghost.audio {
    background: rgba(79, 163, 126, 0.15);
  }

  .ghost.insert {
    border-style: solid;
    border-color: var(--accent);
  }

  .drop-cut {
    position: absolute;
    top: 0;
    left: 0;
    width: 8px;
    background: var(--accent-dim);
    border-left: 2px solid var(--accent);
    border-right: 2px solid var(--accent);
  }

  .guide {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: var(--text-primary);
    opacity: 0.8;
  }

  .razor {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: var(--error);
  }

  .marquee {
    position: absolute;
    top: 0;
    left: 0;
    border: 1px solid var(--accent);
    background: var(--accent-dim);
  }

  .marquee.zoom {
    border-color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
  }

  .bottom {
    display: flex;
    flex-shrink: 0;
    border-top: 1px solid var(--border);
  }

  .corner-bottom {
    width: var(--track-header-w);
    flex-shrink: 0;
    background: var(--bg-surface);
    border-right: 1px solid var(--border);
  }

  .scrollbar-wrap {
    flex: 1;
    min-width: 0;
  }

  .playhead-layer {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    pointer-events: none;
    z-index: 25;
    overflow: hidden;
  }

  .playhead-layer.off {
    visibility: hidden;
  }

  /* trim handles only read as such under the tools that trim */
  .timeline:not(.tool-select):not(.tool-ripple):not(.tool-rolling) :global(.clip-edge) {
    cursor: inherit;
  }

  .timeline:not(.tool-pen) :global(.band-hit) {
    cursor: inherit;
  }

  .timeline:not(.tool-pen) :global(.kf) {
    cursor: inherit;
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11.5px;
    color: var(--text-muted);
  }
</style>
