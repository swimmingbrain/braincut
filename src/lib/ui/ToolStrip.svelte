<script lang="ts">
  import { tools } from '$lib/editor/tools';
  import { activeTool } from '$lib/stores/app';
  import Icon from './Icon.svelte';
</script>

<div class="tool-strip" role="toolbar" aria-label="Timeline tools" aria-orientation="vertical">
  {#each tools as tool (tool.id)}
    <button
      class="tool-btn"
      class:active={$activeTool === tool.id}
      title="{tool.label} ({tool.shortcut})"
      aria-label={tool.label}
      aria-pressed={$activeTool === tool.id}
      onclick={() => activeTool.set(tool.id)}>
      <Icon name={tool.icon} size={15} />
    </button>
  {/each}
</div>

<style>
  .tool-strip {
    width: var(--toolbar-h);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 3px 0;
    background: var(--bg-surface);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }

  .tool-strip::-webkit-scrollbar {
    width: 0;
  }

  .tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .tool-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tool-btn.active {
    background: var(--accent-dim);
    color: var(--accent);
  }
</style>
