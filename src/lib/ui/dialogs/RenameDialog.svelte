<script lang="ts">
  import { get } from 'svelte/store';
  import Dialog from '../Dialog.svelte';
  import { edit, findClip, project } from '$lib/project/store';

  type Target = 'project' | 'clip' | 'media' | 'sequence' | 'bin';

  let { target, id, onclose }: { target: Target; id: string; onclose: () => void } = $props();

  const words: Record<Target, string> = { project: 'project', clip: 'clip', media: 'media item', sequence: 'sequence', bin: 'bin' };

  function currentName(): string {
    const p = get(project);
    if (!p) return '';
    switch (target) {
      case 'project':
        return p.name;
      case 'clip':
        return findClip(p, id)?.clip.name ?? '';
      case 'media':
        return p.media.find((m) => m.id === id)?.name ?? '';
      case 'sequence':
        return p.sequences.find((s) => s.id === id)?.name ?? '';
      case 'bin':
        return p.bins.find((b) => b.id === id)?.name ?? '';
    }
  }

  let name = $state(currentName());

  function apply() {
    const next = name.trim();
    if (!next) return;
    edit(`rename ${words[target]}`, (draft) => {
      switch (target) {
        case 'project':
          draft.name = next;
          break;
        case 'clip': {
          const found = findClip(draft, id);
          if (found) found.clip.name = next;
          break;
        }
        case 'media': {
          const m = draft.media.find((x) => x.id === id);
          if (m) m.name = next;
          break;
        }
        case 'sequence': {
          const s = draft.sequences.find((x) => x.id === id);
          if (s) s.name = next;
          break;
        }
        case 'bin': {
          const b = draft.bins.find((x) => x.id === id);
          if (b) b.name = next;
          break;
        }
      }
    });
    onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    } else if (e.key === 'Escape') {
      onclose();
    }
  }
</script>

<Dialog title={`Rename ${words[target]}`} description="Give it a name you will recognise later." width={380} {onclose}>
  <!-- svelte-ignore a11y_autofocus -->
  <input class="text" bind:value={name} spellcheck="false" aria-label="Name" autofocus {onkeydown} onfocus={(e) => e.currentTarget.select()} />
  {#snippet footer()}
    <button class="dialog-btn" onclick={onclose}>Cancel</button>
    <button class="dialog-btn primary" onclick={apply} disabled={!name.trim()}>Rename</button>
  {/snippet}
</Dialog>

<style>
  .text {
    width: 100%;
    padding: 5px 8px;
    font-family: var(--font-ui);
    font-size: 12.5px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    outline: none;
  }

  .text:focus {
    border-color: var(--accent);
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
