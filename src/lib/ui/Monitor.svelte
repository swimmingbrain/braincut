<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Session } from '$lib/engine/session';

  // the black viewport both monitors share. the canvas belongs to the
  // compositor and keeps the sequence size, this only decides how big it is
  // shown and where. everything drawn on top (safe margins, the transform
  // box) is positioned in the same css box so it lines up with the picture
  let {
    session,
    showSafeMargins = false,
    zoom = 'fit',
    overlay,
    onframedblclick,
    ondragstart,
    ondragend,
    draggable = false
  }: {
    session: Session;
    showSafeMargins?: boolean;
    // 'fit' or a percent of the sequence size, 25..400
    zoom?: 'fit' | number;
    // rendered inside the frame box, gets the css size of the frame in px
    overlay?: Snippet<[{ width: number; height: number; scale: number }]>;
    onframedblclick?: (e: MouseEvent) => void;
    ondragstart?: (e: DragEvent) => void;
    ondragend?: (e: DragEvent) => void;
    draggable?: boolean;
  } = $props();

  let viewport = $state<HTMLDivElement | null>(null);
  let frame = $state<HTMLDivElement | null>(null);
  let viewW = $state(0);
  let viewH = $state(0);
  // the canvas may be resized by the compositor when the quality changes,
  // the sequence aspect is what counts, so read it off the canvas element
  let canvasW = $state(0);
  let canvasH = $state(0);

  const box = $derived.by(() => {
    const cw = canvasW || 16;
    const ch = canvasH || 9;
    if (zoom === 'fit') {
      // a hair of padding so the frame edge never touches the panel edge
      const availW = Math.max(0, viewW - 8);
      const availH = Math.max(0, viewH - 8);
      const scale = Math.min(availW / cw, availH / ch);
      return { width: Math.floor(cw * scale), height: Math.floor(ch * scale), scale };
    }
    const scale = zoom / 100;
    return { width: Math.round(cw * scale), height: Math.round(ch * scale), scale };
  });

  $effect(() => {
    const el = frame;
    const canvas = session.canvas;
    if (!el) return;
    el.appendChild(canvas);
    canvasW = canvas.width;
    canvasH = canvas.height;
    // the compositor swaps the buffer size on quality changes without any
    // event, but setting canvas.width writes the attribute, so a mutation
    // observer notices for free
    const watch = new MutationObserver(() => {
      canvasW = canvas.width;
      canvasH = canvas.height;
    });
    watch.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
    return () => {
      watch.disconnect();
      if (canvas.parentElement === el) el.removeChild(canvas);
    };
  });

  $effect(() => {
    const el = viewport;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect;
      viewW = rect.width;
      viewH = rect.height;
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
</script>

<div class="viewport" class:scroll={zoom !== 'fit'} bind:this={viewport}>
  <div class="center" style:min-width="{box.width}px" style:min-height="{box.height}px">
    <div
      class="frame"
      bind:this={frame}
      style:width="{box.width}px"
      style:height="{box.height}px"
      {draggable}
      role="img"
      aria-label="Video frame"
      ondblclick={onframedblclick}
      ondragstart={ondragstart}
      ondragend={ondragend}>
      {#if showSafeMargins}
        <div class="safe action" aria-hidden="true"></div>
        <div class="safe title" aria-hidden="true"></div>
        <div class="cross h" aria-hidden="true"></div>
        <div class="cross v" aria-hidden="true"></div>
      {/if}
      {#if overlay}
        <div class="overlay">{@render overlay(box)}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    background: #000;
    overflow: hidden;
  }

  .viewport.scroll {
    overflow: auto;
  }

  .center {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .viewport.scroll .center {
    position: relative;
    inset: auto;
    width: 100%;
    height: 100%;
  }

  .frame {
    position: relative;
    flex-shrink: 0;
    background: #000;
    overflow: visible;
  }

  .frame :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }

  .safe {
    position: absolute;
    border: 1px solid rgba(255, 255, 255, 0.35);
    pointer-events: none;
  }

  .safe.action {
    inset: 5%;
  }

  .safe.title {
    inset: 10%;
  }

  .cross {
    position: absolute;
    background: rgba(255, 255, 255, 0.25);
    pointer-events: none;
  }

  .cross.h {
    left: 48%;
    right: 48%;
    top: 50%;
    height: 1px;
  }

  .cross.v {
    top: 48%;
    bottom: 48%;
    left: 50%;
    width: 1px;
  }

  .overlay {
    position: absolute;
    inset: 0;
  }
</style>
