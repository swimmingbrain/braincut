<script lang="ts">
  import Dialog from '../Dialog.svelte';
  import Icon from '../Icon.svelte';
  import { mediaById, project } from '$lib/project/store';
  import { formatDuration } from '$lib/project/time';
  import { formatBytes } from '$lib/media/opfs';
  import { relinkMedia, relinkMissing, sourceName } from '$lib/media/sources';
  import { addToast } from '$lib/stores/app';

  let { mediaId, onclose }: { mediaId: string; onclose: () => void } = $props();

  const media = $derived($mediaById.get(mediaId) ?? null);
  const fileName = $derived(sourceName(mediaId) || media?.fileName || media?.name || '');
  const missing = $derived(($project?.media ?? []).filter((m) => m.status === 'missing').length);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let input = $state<HTMLInputElement | null>(null);

  function aborted(e: unknown): boolean {
    return e instanceof DOMException && e.name === 'AbortError';
  }

  async function link(source: File | FileSystemFileHandle) {
    if (!media) return;
    busy = true;
    error = null;
    try {
      await relinkMedia(mediaId, source);
      addToast(`${media.name} relinked`, 'success');
      onclose();
    } catch (e) {
      error = e instanceof Error ? e.message : 'The file could not be read';
    } finally {
      busy = false;
    }
  }

  async function pick() {
    if ('showOpenFilePicker' in window) {
      try {
        const [handle] = await window.showOpenFilePicker({ multiple: false, id: 'braincut-media' });
        if (handle) await link(handle);
      } catch (e) {
        if (!aborted(e)) error = e instanceof Error ? e.message : 'Could not open the file';
      }
      return;
    }
    input?.click();
  }

  function onfile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) link(file);
  }
</script>

<Dialog title="Relink media" description="Point this clip at the file again." {onclose}>
  {#if media}
    <div class="relink">
      <div class="item">
        <span class="item-icon"><Icon name={media.kind === 'audio' ? 'audio' : media.kind === 'image' ? 'image' : 'film'} size={16} /></span>
        <div class="item-text">
          <span class="item-name">{media.name}</span>
          <span class="item-meta">
            {#if media.width > 0}{media.width}×{media.height}{#if media.fps} {Number(media.fps.toFixed(3))} fps{/if} · {/if}
            {#if media.kind !== 'image'}{formatDuration(media.duration)} · {/if}
            {formatBytes(media.fileSize)}
          </span>
        </div>
      </div>
      <dl class="facts">
        <dt>Was</dt>
        <dd>{fileName}</dd>
        <dt>Status</dt>
        <dd class:missing={media.status === 'missing'}>{media.status === 'missing' ? 'missing' : media.status}{media.statusReason ? ` — ${media.statusReason}` : ''}</dd>
      </dl>
      <p class="help">
        Pick the same file, or a different one: the duration, size and frame rate are read again and every clip using it follows along.
        {#if missing > 1}Relink all picks one folder and matches every missing file in it by name and size.{/if}
      </p>
      {#if error}
        <p class="error">{error}</p>
      {/if}
      <input class="hidden" type="file" bind:this={input} onchange={onfile} aria-hidden="true" tabindex="-1" />
    </div>
  {:else}
    <p class="help">This item is no longer in the project.</p>
  {/if}
  {#snippet footer()}
    <button class="dialog-btn" onclick={onclose}>Cancel</button>
    {#if missing > 1}
      <button class="dialog-btn" onclick={() => { onclose(); void relinkMissing(); }}>Relink all…</button>
    {/if}
    <button class="dialog-btn primary" onclick={pick} disabled={!media || busy}>{busy ? 'Reading…' : 'Pick file…'}</button>
  {/snippet}
</Dialog>

<style>
  .relink {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: var(--bg-deep);
    border: 1px solid var(--border);
  }

  .item-icon {
    display: flex;
    color: var(--text-muted);
  }

  .item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .item-name {
    font-size: 12.5px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-meta {
    font-family: var(--font-editor);
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .facts {
    display: grid;
    grid-template-columns: 60px 1fr;
    gap: 3px 10px;
    font-size: 11.5px;
  }

  dt {
    color: var(--text-muted);
  }

  dd {
    color: var(--text-secondary);
    font-family: var(--font-editor);
    font-size: 11px;
    word-break: break-all;
  }

  dd.missing {
    color: var(--error);
  }

  .help {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .error {
    font-size: 11.5px;
    color: var(--error);
  }

  .hidden {
    display: none;
  }

  .dialog-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .dialog-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dialog-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .dialog-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #111;
  }

  .dialog-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
</style>
