<script lang="ts">
  import Dialog from './Dialog.svelte';
  import NewProjectDialog from './dialogs/NewProjectDialog.svelte';
  import NewSequenceDialog from './dialogs/NewSequenceDialog.svelte';
  import SequenceSettingsDialog from './dialogs/SequenceSettingsDialog.svelte';
  import PreferencesDialog from './dialogs/PreferencesDialog.svelte';
  import ShortcutsDialog from './dialogs/ShortcutsDialog.svelte';
  import AboutDialog from './dialogs/AboutDialog.svelte';
  import RelinkDialog from './dialogs/RelinkDialog.svelte';
  import SpeedDialog from './dialogs/SpeedDialog.svelte';
  import RenameDialog from './dialogs/RenameDialog.svelte';
  import { dialog } from '$lib/stores/app';

  // every dialog the editor can open, in one switch, so the page never has
  // to know which one is up. each body owns its own Dialog frame
  const placeholders: Record<string, { title: string; description: string; width?: number }> = {
    export: { title: 'Export', description: 'Format, codec, quality and range.', width: 520 },
    title: { title: 'Title', description: 'Text, font, colour and placement.', width: 520 }
  };

  function close() {
    dialog.set(null);
  }
</script>

{#if $dialog}
  {#key $dialog}
    {#if $dialog.kind === 'new-project'}
      <NewProjectDialog onclose={close} />
    {:else if $dialog.kind === 'new-sequence'}
      <NewSequenceDialog onclose={close} />
    {:else if $dialog.kind === 'sequence-settings'}
      <SequenceSettingsDialog onclose={close} />
    {:else if $dialog.kind === 'preferences'}
      <PreferencesDialog onclose={close} />
    {:else if $dialog.kind === 'shortcuts'}
      <ShortcutsDialog onclose={close} />
    {:else if $dialog.kind === 'about'}
      <AboutDialog onclose={close} />
    {:else if $dialog.kind === 'relink'}
      <RelinkDialog mediaId={$dialog.mediaId} onclose={close} />
    {:else if $dialog.kind === 'speed'}
      <SpeedDialog clipIds={$dialog.clipIds} onclose={close} />
    {:else if $dialog.kind === 'rename'}
      <RenameDialog target={$dialog.target} id={$dialog.id} onclose={close} />
    {:else}
      {@const current = placeholders[$dialog.kind]}
      <Dialog title={current.title} description={current.description} width={current.width ?? 420} onclose={close}>
        <p class="placeholder">This one is still coming together.</p>
        {#snippet footer()}
          <button class="dialog-btn" onclick={close}>Close</button>
        {/snippet}
      </Dialog>
    {/if}
  {/key}
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
