<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import type { MenuItem } from '$lib/stores/app';
  import Icon from './Icon.svelte';
  import Self from './Menu.svelte';

  // two shapes of the same list: hung under a trigger button (a menu bar
  // entry, a panel's "more" button) or dropped at a point (context menu).
  // one component so both keep the same keys, colors and submenu behaviour
  let {
    items,
    trigger,
    at = null,
    onclose,
    nested = false
  }: {
    items: MenuItem[];
    trigger?: Snippet<[{ open: boolean; toggle: () => void }]>;
    at?: { x: number; y: number } | null;
    onclose?: () => void;
    nested?: boolean;
  } = $props();

  let open = $state(untrack(() => at !== null));
  let panel = $state<HTMLDivElement | null>(null);
  let root = $state<HTMLDivElement | null>(null);
  let activeIndex = $state(-1);
  let openSubmenu = $state(-1);
  let pos = $state(untrack(() => ({ x: at?.x ?? 0, y: at?.y ?? 0 })));

  const positioned = $derived(at !== null);

  function selectable(item: MenuItem): boolean {
    return !item.separator && !item.disabled;
  }

  function close() {
    open = false;
    openSubmenu = -1;
    activeIndex = -1;
    onclose?.();
  }

  function toggle() {
    open = !open;
    if (!open) close();
  }

  function run(item: MenuItem, index: number) {
    if (!selectable(item)) return;
    if (item.children?.length) {
      openSubmenu = openSubmenu === index ? -1 : index;
      return;
    }
    close();
    item.action?.();
  }

  function move(step: number) {
    const count = items.length;
    let next = activeIndex;
    for (let i = 0; i < count; i++) {
      next = (next + step + count) % count;
      if (selectable(items[next])) break;
    }
    activeIndex = next;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'ArrowRight') {
      const item = items[activeIndex];
      if (item?.children?.length) {
        e.preventDefault();
        openSubmenu = activeIndex;
      }
    } else if (e.key === 'ArrowLeft' && nested) {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' || e.key === ' ') {
      const item = items[activeIndex];
      if (item) {
        e.preventDefault();
        run(item, activeIndex);
      }
    }
  }

  function onpointerdown(e: PointerEvent) {
    if (!open) return;
    const target = e.target as Node;
    if (root?.contains(target) || panel?.contains(target)) return;
    close();
  }

  // a menu that would hang off the screen is pulled back inside instead of
  // scrolling the page
  $effect(() => {
    if (!positioned || nested || !panel || !at) return;
    const rect = panel.getBoundingClientRect();
    const x = Math.max(4, Math.min(at.x, window.innerWidth - rect.width - 4));
    const y = Math.max(4, Math.min(at.y, window.innerHeight - rect.height - 4));
    if (x !== pos.x || y !== pos.y) pos = { x, y };
  });

  $effect(() => {
    if (positioned) open = true;
  });

  // the list drives itself from the keyboard once it is up, but only the top
  // level takes focus: a submenu that opens on hover must not steal it
  $effect(() => {
    if (open && panel && !nested) panel.focus();
  });
</script>

<svelte:window onpointerdown={onpointerdown} />

{#if trigger}
  <div class="menu-root" bind:this={root}>
    {@render trigger({ open, toggle })}
    {#if open}
      <div class="menu anchored" bind:this={panel} role="menu" tabindex="-1" {onkeydown}>
        {@render list()}
      </div>
    {/if}
  </div>
{:else if open}
  <div
    class="menu floating"
    class:nested
    bind:this={panel}
    style="left: {pos.x}px; top: {pos.y}px"
    role="menu"
    tabindex="-1"
    {onkeydown}>
    {@render list()}
  </div>
{/if}

{#snippet list()}
  {#each items as item, i}
    {#if item.separator}
      <div class="menu-sep"></div>
    {:else}
      <div class="menu-row">
        <button
          class="menu-item"
          class:active={i === activeIndex}
          class:danger={item.danger}
          disabled={item.disabled}
          role="menuitem"
          onmouseenter={() => {
            activeIndex = i;
            openSubmenu = item.children?.length ? i : -1;
          }}
          onclick={() => run(item, i)}>
          <span class="check">
            {#if item.checked}<Icon name="check" size={12} />{/if}
          </span>
          <span class="label">{item.label}</span>
          {#if item.children?.length}
            <span class="arrow"><Icon name="chevronRight" size={12} /></span>
          {:else if item.shortcut}
            <span class="shortcut">{item.shortcut}</span>
          {/if}
        </button>
        {#if item.children?.length && openSubmenu === i}
          <div class="submenu">
            <Self items={item.children} at={{ x: 0, y: 0 }} nested onclose={close} />
          </div>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

<style>
  .menu-root {
    position: relative;
    display: flex;
    align-items: center;
  }

  .menu {
    min-width: 180px;
    max-width: 320px;
    padding: 3px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    animation: fade-in 80ms ease;
    outline: none;
  }

  .menu.anchored {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 900;
  }

  .menu.floating {
    position: fixed;
    z-index: 1200;
  }

  /* a submenu sits inside its row, the row does the placing */
  .menu.nested {
    position: static;
  }

  .menu-row {
    position: relative;
  }

  .submenu {
    position: absolute;
    top: -4px;
    left: 100%;
    z-index: 1;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px;
    font-size: 12px;
    color: var(--text-secondary);
    text-align: left;
  }

  .menu-item:hover:not(:disabled),
  .menu-item.active:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .menu-item:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .menu-item.danger {
    color: var(--error);
  }

  .check {
    width: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
    flex-shrink: 0;
  }

  .label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shortcut {
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .arrow {
    display: flex;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .menu-sep {
    height: 1px;
    margin: 3px 6px;
    background: var(--border);
  }
</style>
