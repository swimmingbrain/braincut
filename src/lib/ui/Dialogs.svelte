<script lang="ts">
  import Dialog from './Dialog.svelte';
  import { dialog } from '$lib/stores/app';

  // every dialog the editor can open, in one switch. the bodies are placed
  // here so the page never has to know which one is up; each gets its own
  // panel component as it lands
  const titles: Record<string, { title: string; description: string; width?: number }> = {
    'new-project': { title: 'New project', description: 'Name the project and pick the sequence it starts with.' },
    'new-sequence': { title: 'New sequence', description: 'Frame size, frame rate and audio settings.' },
    'sequence-settings': { title: 'Sequence settings', description: 'Change the size and rate of the open sequence.' },
    export: { title: 'Export', description: 'Format, codec, quality and range.', width: 520 },
    preferences: { title: 'Preferences', description: 'How the editor behaves. Everything is stored locally.', width: 520 },
    shortcuts: { title: 'Keyboard shortcuts', description: 'Every key the editor listens to.', width: 640 },
    about: { title: 'About brainCUT', description: 'A video editor that runs entirely in your browser.' },
    relink: { title: 'Relink media', description: 'Point this clip at the file again.' },
    speed: { title: 'Speed and duration', description: 'Change how fast the selected clips play.' },
    title: { title: 'Title', description: 'Text, font, colour and placement.', width: 520 },
    rename: { title: 'Rename', description: 'Give it a name you will recognise later.' }
  };

  const current = $derived($dialog ? titles[$dialog.kind] : null);

  function close() {
    dialog.set(null);
  }
</script>

{#if $dialog && current}
  <Dialog title={current.title} description={current.description} width={current.width ?? 420} onclose={close}>
    <p class="placeholder">This one is still coming together.</p>
    {#snippet footer()}
      <button class="dialog-btn" onclick={close}>Close</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .placeholder {
    font-size: 12px;
    color: var(--text-muted);
    padding: 12px 0;
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
</style>
