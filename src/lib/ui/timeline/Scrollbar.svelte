<script lang="ts">
  import { clampZoom } from '$lib/editor/timeline-interactions';

  // the thumb is the visible window of the sequence. dragging it scrolls,
  // dragging either end zooms while the other end stays put
  let {
    scroll,
    zoom,
    viewWidth,
    duration,
    onchange
  }: {
    scroll: number;
    zoom: number;
    viewWidth: number;
    duration: number;
    onchange: (scroll: number, zoom: number) => void;
  } = $props();

  const MIN_THUMB = 24;
  const END = 7;

  let track = $state<HTMLDivElement | null>(null);

  const visible = $derived(viewWidth / zoom);
  // the scrollable length keeps a screen of room past the last clip
  const total = $derived(Math.max(duration + visible * 0.5, scroll + visible, visible));
  const scale = $derived(viewWidth > 0 ? viewWidth / total : 0);
  const thumbLeft = $derived(scroll * scale);
  const thumbWidth = $derived(Math.max(MIN_THUMB, visible * scale));

  let drag: { kind: 'thumb' | 'start' | 'end'; x: number; scroll: number; zoom: number } | null = null;

  function onpointerdown(e: PointerEvent, kind: 'thumb' | 'start' | 'end') {
    e.preventDefault();
    e.stopPropagation();
    drag = { kind, x: e.clientX, scroll, zoom };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || scale === 0) return;
    const dt = (e.clientX - drag.x) / scale;
    if (drag.kind === 'thumb') {
      onchange(Math.max(0, drag.scroll + dt), drag.zoom);
      return;
    }
    const startTime = drag.scroll;
    const endTime = drag.scroll + viewWidth / drag.zoom;
    if (drag.kind === 'start') {
      const next = Math.min(endTime - 0.1, Math.max(0, startTime + dt));
      const z = clampZoom(viewWidth / (endTime - next));
      onchange(Math.max(0, endTime - viewWidth / z), z);
    } else {
      const next = Math.max(startTime + 0.1, endTime + dt);
      onchange(startTime, clampZoom(viewWidth / (next - startTime)));
    }
  }

  function onpointerup() {
    drag = null;
  }

  // a click beside the thumb pages in that direction
  function ontrackdown(e: PointerEvent) {
    if (!track || scale === 0) return;
    const x = e.clientX - track.getBoundingClientRect().left;
    const page = visible * 0.9;
    onchange(Math.max(0, x < thumbLeft ? scroll - page : scroll + page), zoom);
  }
</script>

<div class="scrollbar" bind:this={track} role="presentation" onpointerdown={ontrackdown}>
  <div
    class="thumb"
    style="transform: translateX({thumbLeft}px); width: {thumbWidth}px"
    role="presentation"
    onpointerdown={(e) => onpointerdown(e, 'thumb')}
    {onpointermove}
    {onpointerup}>
    <div class="end start" style="width: {END}px" role="presentation" onpointerdown={(e) => onpointerdown(e, 'start')}></div>
    <div class="end finish" style="width: {END}px" role="presentation" onpointerdown={(e) => onpointerdown(e, 'end')}></div>
  </div>
</div>

<style>
  .scrollbar {
    position: relative;
    height: 100%;
    background: var(--bg-deep);
    overflow: hidden;
    cursor: default;
  }

  .thumb {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 0;
    background: var(--bg-hover);
    cursor: grab;
    will-change: transform;
  }

  .thumb:hover {
    background: var(--border);
  }

  .thumb:active {
    cursor: grabbing;
  }

  .end {
    position: absolute;
    top: 0;
    bottom: 0;
    cursor: ew-resize;
  }

  .end::after {
    content: '';
    position: absolute;
    top: 2px;
    bottom: 2px;
    width: 1px;
    background: var(--text-muted);
  }

  .start {
    left: 0;
  }

  .start::after {
    left: 2px;
  }

  .finish {
    right: 0;
  }

  .finish::after {
    right: 2px;
  }
</style>
