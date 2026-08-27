<script lang="ts">
  import { commandPaletteOpen } from '$lib/stores/app';
  import { tick } from 'svelte';

  interface Command {
    id: string;
    label: string;
    shortcut?: string;
    action: () => void;
    category?: string;
  }

  export let commands: Command[] = [];

  let query = '';
  let selectedIndex = 0;
  let inputEl: HTMLInputElement;
  let resultsEl: HTMLDivElement;

  // the palette is only in the dom while it is open, so the field has to be
  // given the keyboard every time it appears, not once on mount
  $: if ($commandPaletteOpen) void focusInput();

  async function focusInput() {
    await tick();
    inputEl?.focus();
  }

  $: filtered = commands.filter((cmd) => {
    if (!query) return true;
    const lower = query.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(lower) ||
      (cmd.category?.toLowerCase().includes(lower) ?? false)
    );
  });

  $: selectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));

  function close() {
    commandPaletteOpen.set(false);
    query = '';
    selectedIndex = 0;
  }

  function run(cmd: Command) {
    close();
    cmd.action();
  }

  // arrowing past the bottom of the list has to bring the row into view,
  // otherwise the selection walks off screen
  function move(step: number) {
    selectedIndex = (selectedIndex + step + filtered.length) % filtered.length;
    resultsEl?.children[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function handleKeydown(e: KeyboardEvent) {
    // the input and the backdrop share this handler, the key must not reach
    // both or enter runs one command from the filtered list and another from
    // the full one
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length) move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length) move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        run(filtered[selectedIndex]);
      }
    }
  }

  function handleBackdropClick() {
    close();
  }
</script>

{#if $commandPaletteOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" on:click={handleBackdropClick} on:keydown={handleKeydown}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="palette" on:click|stopPropagation>
      <div class="search-row">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="search-icon">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <input
          bind:this={inputEl}
          bind:value={query}
          placeholder="Type a command..."
          class="search-input"
          on:keydown={handleKeydown}
        />
      </div>

      <div class="results" bind:this={resultsEl}>
        {#if filtered.length === 0}
          <div class="no-results">No matching commands</div>
        {:else}
          {#each filtered as cmd, i (cmd.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="result-item"
              class:selected={i === selectedIndex}
              on:click={() => run(cmd)}
              on:mouseenter={() => (selectedIndex = i)}
            >
              <span class="result-label">{cmd.label}</span>
              {#if cmd.shortcut}
                <span class="result-shortcut">
                  {#each cmd.shortcut.split('+') as key}
                    <kbd>{key}</kbd>
                  {/each}
                </span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    justify-content: center;
    padding-top: 15vh;
    background: rgba(0, 0, 0, 0.5);
  }

  .palette {
    width: 480px;
    max-height: 360px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: fade-in 100ms ease;
    align-self: flex-start;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  .search-icon {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 13px;
    font-family: var(--font-ui);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .results {
    overflow-y: auto;
    padding: 4px;
  }

  .result-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    cursor: pointer;
  }

  .result-item.selected {
    background: var(--bg-hover);
  }

  .result-label {
    font-size: 12.5px;
    color: var(--text-primary);
  }

  .result-shortcut {
    display: flex;
    gap: 2px;
  }

  .no-results {
    padding: 14px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }
</style>
