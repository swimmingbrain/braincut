<script lang="ts">
  import Icon from './Icon.svelte';
  import { history, seekHistory } from '$lib/project/store';

  // index counts applied entries, so row 0 is the state before the first edit
  const rows = $derived(['Open project', ...$history.entries]);
  const current = $derived($history.index);
</script>

<div class="history-panel">
  <div class="toolbar">
    <span class="count">{$history.entries.length} {$history.entries.length === 1 ? 'step' : 'steps'}</span>
    <span class="spacer"></span>
    <button class="tool-btn" disabled={!$history.canUndo} onclick={() => seekHistory(0)} title="Back to the state the project was opened in">
      <Icon name="undo" size={13} />
      <span>Back to start</span>
    </button>
  </div>

  <div class="list" aria-label="History">
    {#each rows as label, i}
      <button
        class="entry"
        class:current={i === current}
        class:undone={i > current}
        aria-current={i === current ? 'step' : undefined}
        onclick={() => seekHistory(i)}
        title={i === current ? 'Current state' : i > current ? 'Redo up to here' : 'Undo back to here'}>
        <span class="index">{i}</span>
        <span class="label">{label}</span>
        {#if i === current}
          <span class="mark"><Icon name="check" size={11} /></span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .history-panel {
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
    height: 32px;
    padding: 0 10px 0 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .count {
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
  }

  .spacer {
    flex: 1;
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

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 0 8px;
  }

  .entry {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 24px;
    padding: 0 10px;
    font-size: 11.5px;
    color: var(--text-secondary);
    text-align: left;
    border-left: 2px solid transparent;
  }

  .entry:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .entry.current {
    background: var(--accent-dim);
    color: var(--text-primary);
    border-left-color: var(--accent);
  }

  .entry.undone {
    opacity: 0.4;
  }

  .index {
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
    width: 24px;
    text-align: right;
    flex-shrink: 0;
  }

  .label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mark {
    display: flex;
    color: var(--accent);
  }
</style>
