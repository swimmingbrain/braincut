<script lang="ts">
  import NewProjectDialog from './dialogs/NewProjectDialog.svelte';
  import NewSequenceDialog from './dialogs/NewSequenceDialog.svelte';
  import SequenceSettingsDialog from './dialogs/SequenceSettingsDialog.svelte';
  import PreferencesDialog from './dialogs/PreferencesDialog.svelte';
  import ShortcutsDialog from './dialogs/ShortcutsDialog.svelte';
  import AboutDialog from './dialogs/AboutDialog.svelte';
  import RelinkDialog from './dialogs/RelinkDialog.svelte';
  import SpeedDialog from './dialogs/SpeedDialog.svelte';
  import RenameDialog from './dialogs/RenameDialog.svelte';
  import ExportDialog from './dialogs/ExportDialog.svelte';
  import TitleDialog from './dialogs/TitleDialog.svelte';
  import { dialog } from '$lib/stores/app';

  // every dialog the editor can open, in one switch, so the page never has
  // to know which one is up. each body owns its own Dialog frame
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
    {:else if $dialog.kind === 'export'}
      <ExportDialog onclose={close} />
    {:else if $dialog.kind === 'title'}
      <TitleDialog clipId={$dialog.clipId} onclose={close} />
    {/if}
  {/key}
{/if}
