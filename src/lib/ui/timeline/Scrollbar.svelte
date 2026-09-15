<script lang="ts">
  import { zoomAround } from '$lib/editor/timeline-interactions';

  // the thumb is the visible window of the sequence. dragging it scrolls,
  // dragging either end zooms around the playhead
  let {
    scroll,
    zoom,
    viewWidth,
    duration,
    playhead,
    onchange
  }: {
    scroll: number;
    zoom: number;
    viewWidth: number;
    duration: number;
    playhead: number;
    onchange: (scroll: number, zoom: number) => void;
  } = $props();

  const MIN_THUMB = 28;
  const END = 9;

  let track = $state<HTMLDivElement | null>(null);

  const visible = $derived(viewWidth / zoom);
  // the scrollable length keeps a screen of room past the last clip
  const total = $derived(Math.max(duration + visible * 0.5, scroll + visible, visible));
  const scale = $derived(viewWidth > 0 ? viewWidth / total : 0);
  const thumbLeft = $derived(scroll * scale);
  const thumbWidth = $derived(Math.max(MIN_THUMB, visible * scale));

  type Drag = {
    kind: 'thumb' | 'start' | 'end';
    x: number;
    scroll: number;
    zoom: number;
    span: number;
    anchorX: number;
  };

  let drag: Drag | null = null;

  function onpointerdown(e: PointerEvent, kind: 'thumb' | 'start' | 'end') {
    e.preventDefault();
    e.stopPropagation();
    // a resize zooms around the playhead, so the frame being watched keeps its
    // place on screen instead of the view growing off one edge. a playhead out
    // of view leaves the middle of the window as the reference
    const onscreen = playhead >= scroll && playhead <= scroll + visible;
    const anchorX = onscreen ? (playhead - scroll) * zoom : viewWidth / 2;
    drag = { kind, x: e.clientX, scroll, zoom, span: visible, anchorX };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onpointermove(e: PointerEvent) {
    if (!drag || scale === 0) return;
    const dt = (e.clientX - drag.x) / scale;
    if (drag.kind === 'thumb') {
      onchange(Math.max(0, drag.scroll + dt), drag.zoom);
      return;
    }
    // the dragged end still sets the span, the anchor decides where it lands
    const span = Math.max(0.1, drag.kind === 'start' ? drag.span - dt : drag.span + dt);
    const next = zoomAround(drag.zoom, drag.scroll, viewWidth / span, drag.anchorX);
    onchange(next.scroll, next.zoom);
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
    top: 3px;
    bottom: 3px;
    width: 1px;
    background: var(--text-muted);
  }

  .start {
    left: 0;
  }

  .start::after {
    left: 3px;
  }

  .finish {
    right: 0;
  }

  .finish::after {
    right: 3px;
  }
</style>
