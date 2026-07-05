<script lang="ts">
  import Dialog from '../Dialog.svelte';

  let { onclose }: { onclose: () => void } = $props();

  interface Shortcut {
    keys: string[];
    what: string;
  }

  // the same map shortcuts.ts binds, written out for people. a '/' between
  // keys means either one
  const groups: { name: string; items: Shortcut[] }[] = [
    {
      name: 'Playback',
      items: [
        { keys: ['Space'], what: 'Play / pause' },
        { keys: ['J', 'K', 'L'], what: 'Shuttle back, stop, forward (press again to double)' },
        { keys: ['←', '→'], what: 'One frame back / forward' },
        { keys: ['Shift', '←/→'], what: 'Five frames' },
        { keys: ['Home', 'End'], what: 'Start / end of the sequence' },
        { keys: ['↑', '↓'], what: 'Previous / next edit' },
        { keys: ['Shift', 'I/O'], what: 'Go to in / out point' }
      ]
    },
    {
      name: 'Marking',
      items: [
        { keys: ['I'], what: 'Mark in' },
        { keys: ['O'], what: 'Mark out' },
        { keys: ['Ctrl', 'Shift', 'X'], what: 'Clear in and out' },
        { keys: ['M'], what: 'Add marker at the playhead' },
        { keys: [';'], what: 'Lift the in/out range' },
        { keys: ['\''], what: 'Extract the in/out range' },
        { keys: [','], what: 'Insert from the source monitor' },
        { keys: ['.'], what: 'Overwrite from the source monitor' }
      ]
    },
    {
      name: 'Editing',
      items: [
        { keys: ['Ctrl', 'K'], what: 'Split at the playhead' },
        { keys: ['Delete'], what: 'Delete selection' },
        { keys: ['Shift', 'Delete'], what: 'Ripple delete' },
        { keys: ['Q'], what: 'Ripple trim previous edit to the playhead' },
        { keys: ['W'], what: 'Ripple trim next edit to the playhead' },
        { keys: ['Ctrl', 'D'], what: 'Default video transition' },
        { keys: ['Ctrl', 'Shift', 'D'], what: 'Default audio transition' },
        { keys: ['Ctrl', 'L'], what: 'Link / unlink audio and video' },
        { keys: ['Shift', 'E'], what: 'Enable / disable clip' },
        { keys: ['Ctrl', 'R'], what: 'Speed and duration' },
        { keys: ['Ctrl', 'Alt', 'M'], what: 'Mute selected clips' },
        { keys: ['Ctrl', 'C/X/V'], what: 'Copy, cut, paste' },
        { keys: ['Ctrl', 'A'], what: 'Select all' },
        { keys: ['Ctrl', 'Shift', 'A'], what: 'Deselect all' },
        { keys: ['Ctrl', 'Z'], what: 'Undo' },
        { keys: ['Ctrl', 'Shift', 'Z'], what: 'Redo (also Ctrl+Y)' },
        { keys: ['Alt', 'drag'], what: 'Duplicate a clip' },
        { keys: ['Ctrl', 'drag'], what: 'Insert instead of overwrite' }
      ]
    },
    {
      name: 'Tools',
      items: [
        { keys: ['V'], what: 'Selection' },
        { keys: ['A'], what: 'Track select' },
        { keys: ['B'], what: 'Ripple edit' },
        { keys: ['N'], what: 'Rolling edit' },
        { keys: ['C'], what: 'Razor' },
        { keys: ['Y'], what: 'Slip' },
        { keys: ['U'], what: 'Slide' },
        { keys: ['P'], what: 'Pen' },
        { keys: ['H'], what: 'Hand' },
        { keys: ['Z'], what: 'Zoom' },
        { keys: ['T'], what: 'Type' }
      ]
    },
    {
      name: 'View',
      items: [
        { keys: ['S'], what: 'Toggle snapping' },
        { keys: ['='], what: 'Zoom in (numpad + too)' },
        { keys: ['-'], what: 'Zoom out (numpad - too)' },
        { keys: ['\\'], what: 'Fit the whole sequence' },
        { keys: ['Shift', '1…5'], what: 'Focus project, source, program, timeline, effects' },
        { keys: ['Ctrl', 'Shift', 'P'], what: 'Command palette (Ctrl+K with nothing selected)' },
        { keys: ['?'], what: 'This list' },
        { keys: ['Escape'], what: 'Cancel / close' }
      ]
    },
    {
      name: 'Project',
      items: [
        { keys: ['Ctrl', 'S'], what: 'Save' },
        { keys: ['Ctrl', 'O'], what: 'Open a project file' },
        { keys: ['Ctrl', 'I'], what: 'Import media' },
        { keys: ['Ctrl', 'N'], what: 'New sequence' },
        { keys: ['Ctrl', 'M'], what: 'Export' },
        { keys: ['Ctrl', 'Shift', 'E'], what: 'Export the current frame' },
        { keys: ['Ctrl', ','], what: 'Preferences' }
      ]
    }
  ];
</script>

<Dialog title="Keyboard shortcuts" description="Every key the editor listens to." width={640} {onclose}>
  <div class="columns">
    {#each groups as group (group.name)}
      <section class="group">
        <h3 class="group-name">{group.name}</h3>
        {#each group.items as item}
          <div class="row">
            <span class="keys">
              {#each item.keys as key, i}
                {#if i > 0}<span class="plus">+</span>{/if}<kbd>{key}</kbd>
              {/each}
            </span>
            <span class="what">{item.what}</span>
          </div>
        {/each}
      </section>
    {/each}
  </div>
  {#snippet footer()}
    <button class="dialog-btn" onclick={onclose}>Close</button>
  {/snippet}
</Dialog>

<style>
  .columns {
    columns: 2;
    column-gap: 24px;
  }

  .group {
    break-inside: avoid;
    margin-bottom: 14px;
  }

  .group-name {
    font-family: var(--font-editor);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
    margin-bottom: 4px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 24px;
    padding: 2px 0;
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 118px;
    flex-wrap: wrap;
  }

  .plus {
    font-size: 10px;
    color: var(--text-muted);
  }

  .what {
    font-size: 11.5px;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .dialog-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .dialog-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  @media (max-width: 560px) {
    .columns {
      columns: 1;
    }
  }
</style>
