<script lang="ts">
  // the accent line through every lane. the head in the ruler is the only
  // part that takes the pointer, the line lets clicks fall through
  let { x, onpointerdown }: { x: number; onpointerdown?: (e: PointerEvent) => void } = $props();
</script>

<div class="playhead" style="transform: translateX({x}px)">
  <div class="head" role="presentation" onpointerdown={onpointerdown}></div>
  <div class="line"></div>
</div>

<style>
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0;
    z-index: 20;
    pointer-events: none;
    will-change: transform;
  }

  .head {
    position: absolute;
    top: 0;
    left: -6px;
    width: 12px;
    height: var(--ruler-h);
    pointer-events: auto;
    cursor: ew-resize;
  }

  /* a small pennant at the bottom of the ruler, so the head reads even when a
     marker sits under it */
  .head::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 8px solid var(--playhead);
  }

  .line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: var(--playhead);
  }
</style>
