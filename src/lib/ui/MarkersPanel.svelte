<script lang="ts">
  import Icon from './Icon.svelte';
  import { labels, labelName, labelColor } from './MediaTile.svelte';
  import type { Id, Marker } from '$lib/project/types';
  import { activeSequence, editSequence } from '$lib/project/store';
  import { addMarker, removeMarker, updateMarker } from '$lib/project/ops';
  import { createMarker } from '$lib/project/defaults';
  import { formatDuration, formatTimecode } from '$lib/project/time';
  import { contextMenu, playhead, type MenuItem } from '$lib/stores/app';
  import { program } from '$lib/engine/session';

  let selected = $state<Id | null>(null);

  const fps = $derived($activeSequence?.fps ?? 25);
  const markers = $derived([...($activeSequence?.markers ?? [])].sort((a, b) => a.time - b.time));
  const current = $derived(markers.find((m) => m.id === selected) ?? null);

  function seek(marker: Marker) {
    selected = marker.id;
    program().player.seek(marker.time);
  }

  function add() {
    const marker = createMarker($playhead);
    editSequence('add marker', (seq) => {
      addMarker(seq, marker);
    });
    selected = marker.id;
  }

  function remove(markerId: Id) {
    editSequence('delete marker', (seq) => {
      removeMarker(seq, markerId);
    });
    if (selected === markerId) selected = null;
  }

  function patch(markerId: Id, label: string, changes: Partial<Omit<Marker, 'id'>>) {
    editSequence(label, (seq) => {
      updateMarker(seq, markerId, changes);
    });
  }

  function commitText(marker: Marker, key: 'name' | 'note', e: Event) {
    const value = (e.currentTarget as HTMLInputElement).value;
    if (value !== marker[key]) patch(marker.id, key === 'name' ? 'rename marker' : 'edit marker note', { [key]: value });
  }

  function ontextkeydown(e: KeyboardEvent) {
    // the panel's shortcuts must not fire while typing a name
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur();
  }

  function colorMenu(marker: Marker): MenuItem[] {
    return [
      ...labels.map((l) => ({ label: labelName(l), checked: marker.color === l, action: () => patch(marker.id, 'color marker', { color: l }) })),
      { separator: true, label: '' },
      { label: 'Go to marker', action: () => seek(marker) },
      { label: 'Delete', danger: true, action: () => remove(marker.id) }
    ];
  }

  function oncontextmenu(e: MouseEvent, marker: Marker) {
    e.preventDefault();
    selected = marker.id;
    contextMenu.set({ x: e.clientX, y: e.clientY, items: colorMenu(marker) });
  }

  function onlistkeydown(e: KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      remove(selected);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (markers.length === 0) return;
      e.preventDefault();
      const i = markers.findIndex((m) => m.id === selected);
      const next = markers[(i + (e.key === 'ArrowDown' ? 1 : -1) + markers.length) % markers.length];
      seek(next);
    }
  }
</script>

<div class="markers-panel">
  <div class="toolbar">
    <button class="tool-btn" onclick={add} disabled={!$activeSequence} title="Add a marker at the playhead (M)">
      <Icon name="marker" size={13} />
      <span>Add marker</span>
    </button>
    <button class="tool-btn" onclick={() => current && remove(current.id)} disabled={!current} title="Delete the selected marker">
      <Icon name="trash" size={13} />
      <span>Delete</span>
    </button>
    <span class="spacer"></span>
    <span class="count">{markers.length} {markers.length === 1 ? 'marker' : 'markers'}</span>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="list" role="listbox" aria-label="Markers" tabindex="0" onkeydown={onlistkeydown}>
    {#if markers.length === 0}
      <div class="empty">
        <p>No markers in this sequence.</p>
        <span class="hint">Press M on the timeline to drop one at the playhead.</span>
      </div>
    {:else}
      {#each markers as marker (marker.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="marker"
          class:selected={marker.id === selected}
          role="option"
          aria-selected={marker.id === selected}
          tabindex="-1"
          onclick={() => (selected = marker.id)}
          oncontextmenu={(e) => oncontextmenu(e, marker)}>
          <button
            class="dot"
            style="background: {labelColor(marker.color)}"
            title="Change the color"
            aria-label="Marker color"
            onclick={(e) => {
              e.stopPropagation();
              selected = marker.id;
              contextMenu.set({ x: e.clientX, y: e.clientY, items: colorMenu(marker) });
            }}></button>
          <button class="time" onclick={() => seek(marker)} title="Go to the marker">{formatTimecode(marker.time, fps)}</button>
          <div class="fields">
            <input
              class="name"
              value={marker.name}
              placeholder="Marker"
              spellcheck="false"
              aria-label="Marker name"
              onfocus={() => (selected = marker.id)}
              onkeydown={ontextkeydown}
              onblur={(e) => commitText(marker, 'name', e)} />
            <input
              class="note"
              value={marker.note}
              placeholder="Note"
              spellcheck="false"
              aria-label="Marker note"
              onfocus={() => (selected = marker.id)}
              onkeydown={ontextkeydown}
              onblur={(e) => commitText(marker, 'note', e)} />
          </div>
          <span class="duration" title="Duration">{marker.duration > 0 ? formatDuration(marker.duration) : '—'}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .markers-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--bg-elevated);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .tool-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 7px;
    font-size: 11.5px;
    color: var(--text-secondary);
  }

  .tool-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tool-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .spacer {
    flex: 1;
  }

  .count {
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    outline: none;
  }

  .list:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .marker {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    outline: none;
  }

  .marker:hover {
    background: var(--bg-hover);
  }

  .marker.selected {
    background: var(--accent-dim);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid rgba(0, 0, 0, 0.3);
  }

  .time {
    font-family: var(--font-editor);
    font-size: 11px;
    color: var(--accent);
    padding: 2px 4px;
    flex-shrink: 0;
  }

  .time:hover {
    background: var(--bg-elevated);
  }

  .fields {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .fields input {
    width: 100%;
    padding: 1px 4px;
    font-family: var(--font-ui);
    color: var(--text-primary);
    background: none;
    border: 1px solid transparent;
    outline: none;
  }

  .fields input:hover {
    border-bottom-color: var(--border);
  }

  .fields input:focus {
    background: var(--bg-deep);
    border-color: var(--accent);
  }

  .fields input::placeholder {
    color: var(--text-muted);
  }

  .name {
    font-size: 12px;
  }

  .note {
    font-size: 11px;
    color: var(--text-secondary);
  }

  .duration {
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
    width: 40px;
    text-align: right;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 28px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }

  .hint {
    font-family: var(--font-editor);
    font-size: 10px;
  }

  @media (max-width: 360px) {
    .note,
    .duration {
      display: none;
    }
  }
</style>
