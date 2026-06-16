<script lang="ts">
  import type { Transition } from '$lib/project/types';
  import { transitionDef } from '$lib/engine/transitions/registry';
  import { timeToX } from '$lib/editor/timeline-interactions';

  let {
    transition,
    zoom,
    scroll,
    selected
  }: {
    transition: Transition;
    zoom: number;
    scroll: number;
    selected: boolean;
  } = $props();

  const x = $derived(timeToX(transition.start, zoom, scroll));
  const width = $derived(Math.max(2, transition.duration * zoom));
  const name = $derived(transitionDef(transition.type)?.name ?? transition.type);
  // one sided transitions come from or go to black, the slope shows which
  const slope = $derived(transition.leftClipId && transition.rightClipId ? 'cross' : transition.leftClipId ? 'out' : 'in');
</script>

<div
  class="transition tl-hatch {slope}"
  class:selected
  data-transition={transition.id}
  style="transform: translateX({x}px); width: {width}px"
  title={name}>
  {#if width > 40}
    <span class="name">{name}</span>
  {/if}
</div>

<style>
  .transition {
    position: absolute;
    top: 1px;
    left: 0;
    height: calc(100% - 2px);
    background-color: var(--bg-hover);
    border: 1px solid var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    cursor: pointer;
    z-index: 5;
    will-change: transform;
  }

  .transition.selected {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .name {
    font-family: var(--font-editor);
    font-size: 9.5px;
    color: var(--text-primary);
    white-space: nowrap;
    padding: 0 4px;
    background: rgba(17, 17, 19, 0.65);
    pointer-events: none;
  }

  /* the diagonal is the classic picture of a dissolve */
  .transition::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(to top right, transparent calc(50% - 0.5px), var(--text-muted) calc(50% - 0.5px), var(--text-muted) calc(50% + 0.5px), transparent calc(50% + 0.5px));
    opacity: 0.7;
  }

  .transition.out::before {
    background: linear-gradient(to bottom right, transparent calc(50% - 0.5px), var(--text-muted) calc(50% - 0.5px), var(--text-muted) calc(50% + 0.5px), transparent calc(50% + 0.5px));
  }
</style>
