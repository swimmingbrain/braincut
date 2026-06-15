<script lang="ts">
  import type { Marker } from '$lib/project/types';

  let {
    marker,
    x,
    width,
    selected,
    editing,
    onpointerdown,
    ondblclick,
    onrename,
    oncancel
  }: {
    marker: Marker;
    x: number;
    // px of a ranged marker, 0 for a point
    width: number;
    selected: boolean;
    editing: boolean;
    onpointerdown: (e: PointerEvent) => void;
    ondblclick: (e: MouseEvent) => void;
    onrename: (name: string) => void;
    oncancel: () => void;
  } = $props();

  const color = $derived(marker.color === 'none' ? 'var(--text-secondary)' : `var(--label-${marker.color})`);

  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (editing && input) {
      input.focus();
      input.select();
    }
  });

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') onrename((e.currentTarget as HTMLInputElement).value);
    else if (e.key === 'Escape') oncancel();
  }
</script>

<div
  class="marker"
  class:selected
  data-marker={marker.id}
  style="transform: translateX({x}px); --marker-color: {color}"
  title={marker.name || 'Marker'}
  role="presentation"
  {onpointerdown}
  {ondblclick}>
  {#if width > 0}
    <div class="range" style="width: {width}px"></div>
  {/if}
  <div class="flag"></div>
  {#if editing}
    <input
      class="rename"
      bind:this={input}
      value={marker.name}
      spellcheck="false"
      onkeydown={onkeydown}
      onblur={(e) => onrename((e.currentTarget as HTMLInputElement).value)}
      onpointerdown={(e) => e.stopPropagation()} />
  {:else if marker.name}
    <span class="name">{marker.name}</span>
  {/if}
</div>

<style>
  .marker {
    position: absolute;
    top: 2px;
    left: 0;
    height: 12px;
    display: flex;
    align-items: flex-start;
    cursor: pointer;
    z-index: 3;
  }

  .flag {
    width: 9px;
    height: 12px;
    flex-shrink: 0;
    /* a pennant: a small rectangle with a notch on the right, like the icon */
    background: var(--marker-color);
    clip-path: polygon(0 0, 100% 0, 75% 50%, 100% 100%, 0 100%);
  }

  .marker.selected .flag {
    outline: 1px solid var(--text-primary);
    outline-offset: 1px;
  }

  .range {
    position: absolute;
    top: 4px;
    left: 0;
    height: 4px;
    background: var(--marker-color);
    opacity: 0.5;
  }

  .name {
    margin-left: 3px;
    font-family: var(--font-editor);
    font-size: 9.5px;
    line-height: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
    pointer-events: none;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rename {
    margin-left: 3px;
    width: 120px;
    height: 14px;
    padding: 0 3px;
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-focus);
    outline: none;
  }
</style>
