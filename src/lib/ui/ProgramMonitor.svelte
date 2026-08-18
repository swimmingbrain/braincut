<script lang="ts">
  import { onMount } from 'svelte';
  import { program, resetPreview, sessionEpoch, type Session } from '$lib/engine/session';
  import { computeSpriteTransform, readTransform } from '$lib/engine/transform';
  import { isAnimated, paramsAt, setKeyframe } from '$lib/project/keyframes';
  import { addMarker, clipAt, findClipById, setInOut, sequenceDuration } from '$lib/project/ops';
  import { createMarker } from '$lib/project/defaults';
  import { activeSequence, commitPreview, editSequence, mediaById, preview, selectClips } from '$lib/project/store';
  import type { Clip, ParamValue, Project } from '$lib/project/types';
  import { addToast, playhead, previewQuality, selection, showSafeMargins } from '$lib/stores/app';
  import { preferences } from '$lib/stores/preferences';
  import { openFrameExportMenu } from '$lib/editor/export-actions';
  import Icon from './Icon.svelte';
  import Monitor from './Monitor.svelte';
  import Transport from './Transport.svelte';

  let session = $state<Session | null>(null);
  let zoom = $state<'fit' | number>('fit');
  let recentDrops = $state(0);
  let problem = $state<string | null>(null);

  const scales = [1, 0.5, 0.25, 0.125];

  onMount(() => {
    // the saved preference is what the monitor should open at
    const saved = $preferences.previewQuality;
    if (scales.includes(saved)) previewQuality.set(saved as 1 | 0.5 | 0.25 | 0.125);

    let detach = () => {};
    // a reset throws the session away, this picks up the one that replaced it
    const off = sessionEpoch.subscribe(() => {
      detach();
      const s = program();
      session = s;
      s.player.setQuality($previewQuality);
      // dropped frames are only worth a word while they are happening
      let seen = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const stats = s.player.stats.subscribe((value) => {
        if (value.dropped > seen) {
          recentDrops = value.dropped - seen;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => (recentDrops = 0), 1000);
        }
        seen = value.dropped;
      });
      const problems = s.player.problem.subscribe((value) => (problem = value));
      detach = () => {
        stats();
        problems();
        if (timer) clearTimeout(timer);
      };
    });
    return () => {
      off();
      detach();
    };
  });

  function reset() {
    resetPreview();
    addToast('Preview reset', 'info');
  }

  const zoomOptions = [
    { value: 'fit', label: 'Fit' },
    { value: '25', label: '25%' },
    { value: '50', label: '50%' },
    { value: '100', label: '100%' },
    { value: '200', label: '200%' }
  ];
  const qualityOptions = [
    { value: '1', label: 'Full' },
    { value: '0.5', label: '1/2' },
    { value: '0.25', label: '1/4' },
    { value: '0.125', label: '1/8' }
  ];

  function setQuality(v: string) {
    const q = Number(v) as 1 | 0.5 | 0.25 | 0.125;
    previewQuality.set(q);
    session?.player.setQuality(q);
  }

  const duration = $derived($activeSequence ? sequenceDuration($activeSequence) : 0);

  function markIn() {
    editSequence('mark in', (seq) => setInOut(seq, $playhead, seq.outPoint));
  }

  function markOut() {
    editSequence('mark out', (seq) => setInOut(seq, seq.inPoint, $playhead));
  }

  function marker() {
    editSequence('add marker', (seq) => addMarker(seq, createMarker($playhead)));
  }

  // the button offers both formats, the shortcut stays on png
  function exportFrame(event: MouseEvent) {
    openFrameExportMenu(event);
  }

  // the topmost visual clip under the playhead, what a double click picks
  function visualClipAtPlayhead(): Clip | null {
    const seq = $activeSequence;
    if (!seq) return null;
    const video = seq.tracks.filter((t) => t.kind === 'video' && !t.hidden);
    for (let i = video.length - 1; i >= 0; i--) {
      const clip = clipAt(video[i], $playhead);
      if (clip && clip.enabled) return clip;
    }
    return null;
  }

  function onframedblclick() {
    const clip = visualClipAtPlayhead();
    if (clip) selectClips([clip.id]);
  }

  // the transform box: only for one selected visual clip that is on screen
  const target = $derived.by(() => {
    const seq = $activeSequence;
    if (!seq || $selection.length === 0) return null;
    const visual = $selection
      .map((id) => findClipById(seq, id))
      .filter((f): f is NonNullable<typeof f> => !!f && f.clip.kind !== 'audio');
    if (visual.length !== 1) return null;
    const { clip } = visual[0];
    if ($playhead < clip.start || $playhead >= clip.start + clip.duration) return null;
    const effect = clip.effects.find((e) => e.type === 'transform');
    if (!effect) return null;
    const media = clip.mediaId ? $mediaById.get(clip.mediaId) : undefined;
    const w = media && media.width > 0 ? media.width : seq.width;
    const h = media && media.height > 0 ? media.height : seq.height;
    const clipTime = $playhead - clip.start;
    const params = readTransform(paramsAt(effect, clipTime));
    const sprite = computeSpriteTransform(params, w, h, seq.width, seq.height);
    return { clip, effect, clipTime, params, sprite, w, h, seqW: seq.width, seqH: seq.height };
  });

  interface Box {
    corners: [number, number][];
    pivot: [number, number];
    top: [number, number];
    handle: [number, number];
  }

  // corners in css px of the frame box, in the order tl tr br bl
  function geometry(t: NonNullable<typeof target>, scale: number): Box {
    const { sprite, w, h } = t;
    const cos = Math.cos(sprite.rotation);
    const sin = Math.sin(sprite.rotation);
    const map = (mx: number, my: number): [number, number] => {
      const dx = (mx - sprite.pivot.x) * sprite.scaleX;
      const dy = (my - sprite.pivot.y) * sprite.scaleY;
      return [(sprite.x + dx * cos - dy * sin) * scale, (sprite.y + dx * sin + dy * cos) * scale];
    };
    const corners: [number, number][] = [map(0, 0), map(w, 0), map(w, h), map(0, h)];
    const top: [number, number] = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
    // the rotation handle sits a fixed distance out from the top edge
    const len = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]) || 1;
    const nx = -(corners[1][1] - corners[0][1]) / len;
    const ny = (corners[1][0] - corners[0][0]) / len;
    const outward = h * sprite.scaleY >= 0 ? 1 : -1;
    const handle: [number, number] = [top[0] + nx * 22 * outward, top[1] + ny * 22 * outward];
    return { corners, pivot: [sprite.x * scale, sprite.y * scale], top, handle };
  }

  function writeTransform(draft: Project, clipId: string, values: Record<string, ParamValue>, clipTime: number) {
    const seq = draft.sequences.find((s) => s.id === draft.activeSequenceId) ?? draft.sequences[0];
    const found = seq ? findClipById(seq, clipId) : null;
    const effect = found?.clip.effects.find((e) => e.type === 'transform');
    if (!effect) return;
    for (const [key, value] of Object.entries(values)) {
      if (isAnimated(effect, key)) setKeyframe(effect, key, clipTime, value);
      else effect.params[key] = value;
    }
  }

  type Mode = 'move' | 'scale' | 'rotate';

  function startManipulation(e: PointerEvent, mode: Mode, scale: number, corner?: number) {
    const t = target;
    if (!t || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget as SVGElement;
    el.setPointerCapture(e.pointerId);
    const clipId = t.clip.id;
    const clipTime = t.clipTime;
    const start = t.params;
    const geo = geometry(t, scale);
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = (el.closest('.hit') as HTMLElement).getBoundingClientRect();
    const px = rect.left + geo.pivot[0];
    const py = rect.top + geo.pivot[1];
    const startDist = Math.max(1, Math.hypot(startX - px, startY - py));
    const startAngle = Math.atan2(startY - py, startX - px);
    const cos = Math.cos(t.sprite.rotation);
    const sin = Math.sin(t.sprite.rotation);
    let frame = 0;
    let moved = false;

    function apply(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let values: Record<string, ParamValue>;
      if (mode === 'move') {
        values = { position: [start.position[0] + dx / scale, start.position[1] + dy / scale] };
      } else if (mode === 'rotate') {
        const angle = Math.atan2(ev.clientY - py, ev.clientX - px);
        let deg = start.rotation + ((angle - startAngle) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        values = { rotation: Math.round(deg * 10) / 10 };
      } else if (ev.shiftKey && corner !== undefined) {
        // free scale: how far the corner moved along each sprite axis
        const cx = geo.corners[corner][0] - geo.pivot[0];
        const cy = geo.corners[corner][1] - geo.pivot[1];
        const lx0 = cx * cos + cy * sin;
        const ly0 = -cx * sin + cy * cos;
        const lx1 = (cx + dx) * cos + (cy + dy) * sin;
        const ly1 = -(cx + dx) * sin + (cy + dy) * cos;
        const fx = Math.abs(lx0) > 1 ? lx1 / lx0 : 1;
        const fy = Math.abs(ly0) > 1 ? ly1 / ly0 : 1;
        const base = start.uniformScale ? start.scale : start.scaleY;
        values = {
          uniformScale: false,
          scale: Math.max(1, Math.round(start.scale * fx * 10) / 10),
          scaleY: Math.max(1, Math.round(base * fy * 10) / 10)
        };
      } else {
        const dist = Math.hypot(ev.clientX - px, ev.clientY - py);
        const f = dist / startDist;
        values = { scale: Math.max(1, Math.round(start.scale * f * 10) / 10) };
        if (!start.uniformScale) values.scaleY = Math.max(1, Math.round(start.scaleY * f * 10) / 10);
      }
      preview((draft) => writeTransform(draft, clipId, values, clipTime));
    }

    function move(ev: PointerEvent) {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 2) return;
      moved = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(ev));
    }

    function up(ev: PointerEvent) {
      cancelAnimationFrame(frame);
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (!moved) return;
      apply(ev);
      const label = mode === 'move' ? 'move clip in monitor' : mode === 'scale' ? 'scale clip in monitor' : 'rotate clip in monitor';
      commitPreview(label);
    }

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function points(list: [number, number][]): string {
    return list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  }
</script>

<div class="program">
  <div class="header">
    <span class="title">Program: <span class="name">{$activeSequence?.name ?? 'No sequence'}</span></span>
    <div class="controls">
      <select class="mini" aria-label="Zoom" value={zoom === 'fit' ? 'fit' : String(zoom)} onchange={(e) => (zoom = e.currentTarget.value === 'fit' ? 'fit' : Number(e.currentTarget.value))}>
        {#each zoomOptions as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
      </select>
      <select class="mini" aria-label="Playback quality" value={String($previewQuality)} onchange={(e) => setQuality(e.currentTarget.value)}>
        {#each qualityOptions as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
      </select>
      <button
        class="hbtn"
        class:active={$showSafeMargins}
        title="Safe margins"
        aria-label="Safe margins"
        aria-pressed={$showSafeMargins}
        onclick={() => showSafeMargins.update((v) => !v)}>
        <Icon name="fit" size={14} />
      </button>
      <button
        class="hbtn"
        class:alert={problem !== null}
        title={problem ? `Reset preview — ${problem}` : 'Reset preview'}
        aria-label="Reset preview"
        onclick={reset}>
        <Icon name="loop" size={14} />
      </button>
      <button class="hbtn" title="Export frame (Ctrl+Shift+E)" aria-label="Export frame" onclick={exportFrame}>
        <Icon name="camera" size={14} />
      </button>
    </div>
  </div>

  {#if session && $activeSequence}
    <Monitor {session} showSafeMargins={$showSafeMargins} {zoom} {onframedblclick}>
      {#snippet overlay(box)}
        {@const t = target}
        {#if t && box.width > 0}
          {@const scale = box.width / t.seqW}
          {@const geo = geometry(t, scale)}
          <svg class="hit" width={box.width} height={box.height} aria-label="Clip transform">
            <polygon
              class="body"
              points={points(geo.corners)}
              role="button"
              tabindex="-1"
              aria-label="Move clip"
              onpointerdown={(e) => startManipulation(e, 'move', scale)} />
            <line class="stem" x1={geo.top[0]} y1={geo.top[1]} x2={geo.handle[0]} y2={geo.handle[1]} />
            {#each geo.corners as [x, y], i (i)}
              <rect
                class="handle"
                x={x - 4}
                y={y - 4}
                width="8"
                height="8"
                role="button"
                tabindex="-1"
                aria-label="Scale clip"
                onpointerdown={(e) => startManipulation(e, 'scale', scale, i)} />
            {/each}
            <circle
              class="handle rotate"
              cx={geo.handle[0]}
              cy={geo.handle[1]}
              r="4.5"
              role="button"
              tabindex="-1"
              aria-label="Rotate clip"
              onpointerdown={(e) => startManipulation(e, 'rotate', scale)} />
            <circle class="pivot" cx={geo.pivot[0]} cy={geo.pivot[1]} r="2.5" />
          </svg>
        {/if}
        {#if recentDrops > 0}
          <span class="drops">dropped {recentDrops}</span>
        {/if}
        {#if problem}
          <div class="stuck">
            <span class="what">The preview stopped drawing.</span>
            <span class="why">{problem}</span>
            <button class="action-btn" onclick={reset}>Reset preview</button>
          </div>
        {/if}
      {/snippet}
    </Monitor>
    <Transport
      player={session.player}
      fps={$activeSequence.fps}
      {duration}
      inPoint={$activeSequence.inPoint}
      outPoint={$activeSequence.outPoint}
      onmarkin={markIn}
      onmarkout={markOut}
      onaddmarker={marker} />
  {:else}
    <div class="empty">No sequence open</div>
  {/if}
</div>

<style>
  .program {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-surface);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 32px;
    padding: 0 4px 0 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .title {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .name {
    color: var(--text-primary);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .mini {
    height: 22px;
    padding: 0 16px 0 6px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid transparent;
    border-radius: 0;
    outline: none;
    appearance: none;
    cursor: pointer;
    background-image: linear-gradient(45deg, transparent 50%, var(--text-muted) 50%),
      linear-gradient(135deg, var(--text-muted) 50%, transparent 50%);
    background-position: calc(100% - 9px) 9px, calc(100% - 6px) 9px;
    background-size: 3px 3px, 3px 3px;
    background-repeat: no-repeat;
  }

  .mini:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .mini:focus {
    border-color: var(--accent);
  }

  .hbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    color: var(--text-secondary);
  }

  .hbtn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .hbtn.active {
    color: var(--accent);
    background: var(--accent-dim);
  }

  .hbtn.alert {
    color: var(--error);
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11.5px;
    color: var(--text-muted);
    background: #000;
  }

  .hit {
    position: absolute;
    inset: 0;
    overflow: visible;
  }

  .body {
    fill: transparent;
    stroke: var(--accent);
    stroke-width: 1;
    cursor: move;
    outline: none;
  }

  .body:hover {
    fill: var(--accent-dim);
  }

  .stem {
    stroke: var(--accent);
    stroke-width: 1;
    opacity: 0.7;
  }

  .handle {
    fill: var(--bg-deep);
    stroke: var(--accent);
    stroke-width: 1;
    cursor: nwse-resize;
    outline: none;
  }

  .handle:hover {
    fill: var(--accent);
  }

  .handle.rotate {
    cursor: grab;
  }

  .pivot {
    fill: var(--accent);
    pointer-events: none;
  }

  .stuck {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    text-align: center;
    background: rgba(17, 17, 19, 0.82);
  }

  .stuck .what {
    font-size: 12.5px;
    color: var(--text-primary);
  }

  .stuck .why {
    font-family: var(--font-editor);
    font-size: 11px;
    color: var(--text-muted);
    max-width: 90%;
    overflow-wrap: anywhere;
  }

  .stuck .action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .stuck .action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--accent);
  }

  .drops {
    position: absolute;
    right: 6px;
    bottom: 4px;
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--warning);
    opacity: 0.7;
    pointer-events: none;
  }
</style>
