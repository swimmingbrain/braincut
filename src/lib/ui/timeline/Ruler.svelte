<script lang="ts">
  import type { Marker, Sequence } from '$lib/project/types';
  import { commitPreview, editSequence, preview, cancelPreview } from '$lib/project/store';
  import * as ops from '$lib/project/ops';
  import { createMarker } from '$lib/project/defaults';
  import { formatTimecode } from '$lib/project/time';
  import { frameTime, rulerTicks, timeToX, xToTime } from '$lib/editor/timeline-interactions';
  import MarkerFlag from './MarkerFlag.svelte';

  let {
    seq,
    zoom,
    scroll,
    width,
    selectedMarkerId,
    onseek,
    onselectmarker
  }: {
    seq: Sequence;
    zoom: number;
    scroll: number;
    width: number;
    selectedMarkerId: string | null;
    onseek: (time: number) => void;
    onselectmarker: (id: string | null) => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);
  let el = $state<HTMLDivElement | null>(null);
  let editingId = $state<string | null>(null);

  const fps = $derived(seq.fps);
  const viewEnd = $derived(scroll + width / zoom);
  const visibleMarkers = $derived(seq.markers.filter((m) => m.time + m.duration >= scroll && m.time <= viewEnd));

  // canvas colors come from the same tokens as everything else
  let colors: { tick: string; label: string } | null = null;
  function palette() {
    if (colors) return colors;
    const style = getComputedStyle(document.documentElement);
    colors = { tick: style.getPropertyValue('--border').trim(), label: style.getPropertyValue('--text-muted').trim() };
    return colors;
  }

  $effect(() => {
    if (!canvas || width <= 0) return;
    const ticks = rulerTicks(scroll, zoom, width, fps);
    const dpr = window.devicePixelRatio || 1;
    const h = 28;
    canvas.width = Math.round(width * dpr);
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { tick, label } = palette();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, h);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = tick;
    for (const t of ticks) {
      const x = Math.round(timeToX(t.time, zoom, scroll)) + 0.5;
      ctx.fillRect(x, h - (t.major ? 10 : 5), 1, t.major ? 10 : 5);
    }
    ctx.fillStyle = label;
    for (const t of ticks) {
      if (!t.major) continue;
      const x = Math.round(timeToX(t.time, zoom, scroll));
      ctx.fillText(formatTimecode(t.time, fps, { showHours: false }), x + 4, 13);
    }
  });

  function localX(e: { clientX: number }): number {
    return el ? e.clientX - el.getBoundingClientRect().left : 0;
  }

  // dragging on the ruler scrubs. a marker under the pointer moves instead
  let scrubbing = false;
  let markerDrag: { id: string; x0: number; time: number; moved: boolean } | null = null;

  function onpointerdown(e: PointerEvent) {
    if (e.button !== 0 || !el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    scrubbing = true;
    onselectmarker(null);
    onseek(frameTime(xToTime(localX(e), zoom, scroll), fps));
  }

  function onmarkerdown(e: PointerEvent, marker: Marker) {
    if (e.button !== 0 || !el) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    markerDrag = { id: marker.id, x0: e.clientX, time: marker.time, moved: false };
    onselectmarker(marker.id);
  }

  function onpointermove(e: PointerEvent) {
    if (markerDrag) {
      const dx = e.clientX - markerDrag.x0;
      if (!markerDrag.moved && Math.abs(dx) < 3) return;
      markerDrag.moved = true;
      const time = frameTime(markerDrag.time + dx / zoom, fps);
      const id = markerDrag.id;
      const seqId = seq.id;
      cancelPreview();
      preview((d) => {
        const s = d.sequences.find((x) => x.id === seqId);
        if (s) ops.updateMarker(s, id, { time });
      });
      return;
    }
    if (scrubbing) onseek(frameTime(xToTime(localX(e), zoom, scroll), fps));
  }

  function onpointerup() {
    if (markerDrag) {
      if (markerDrag.moved) commitPreview('move marker');
      else onseek(markerDrag.time);
      markerDrag = null;
    }
    scrubbing = false;
  }

  function ondblclick(e: MouseEvent) {
    // an empty spot on the ruler gets a marker, a marker gets renamed
    const time = frameTime(xToTime(localX(e), zoom, scroll), fps);
    editSequence('add marker', (s) => ops.addMarker(s, createMarker(time)));
  }

  function rename(id: string, name: string) {
    editingId = null;
    editSequence('rename marker', (s) => ops.updateMarker(s, id, { name: name.trim() }));
  }

  const inX = $derived(seq.inPoint === null ? null : timeToX(seq.inPoint, zoom, scroll));
  const outX = $derived(seq.outPoint === null ? null : timeToX(seq.outPoint, zoom, scroll));
</script>

<div
  class="ruler"
  bind:this={el}
  role="presentation"
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  onpointercancel={onpointerup}
  {ondblclick}>
  <canvas bind:this={canvas} style="width: {width}px; height: 28px"></canvas>
  {#if inX !== null && outX !== null}
    <div class="range" style="transform: translateX({inX}px); width: {Math.max(1, outX - inX)}px"></div>
  {/if}
  {#if inX !== null}
    <div class="mark in" style="transform: translateX({inX}px)"></div>
  {/if}
  {#if outX !== null}
    <div class="mark out" style="transform: translateX({outX - 1}px)"></div>
  {/if}
  {#each visibleMarkers as marker (marker.id)}
    <MarkerFlag
      {marker}
      x={timeToX(marker.time, zoom, scroll)}
      width={marker.duration * zoom}
      selected={marker.id === selectedMarkerId}
      editing={marker.id === editingId}
      onpointerdown={(e) => onmarkerdown(e, marker)}
      ondblclick={(e) => {
        e.stopPropagation();
        editingId = marker.id;
      }}
      onrename={(name) => rename(marker.id, name)}
      oncancel={() => (editingId = null)} />
  {/each}
</div>

<style>
  .ruler {
    position: relative;
    height: var(--ruler-h);
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
    cursor: ew-resize;
    user-select: none;
  }

  canvas {
    display: block;
  }

  .range {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    background: var(--accent-dim);
    pointer-events: none;
  }

  .mark {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: var(--accent);
    pointer-events: none;
  }

  /* small brackets so in and out can be told apart when they sit close */
  .mark::after {
    content: '';
    position: absolute;
    top: 0;
    width: 4px;
    height: 4px;
    background: var(--accent);
  }

  .mark.in::after {
    left: 0;
  }

  .mark.out::after {
    right: 0;
  }
</style>
