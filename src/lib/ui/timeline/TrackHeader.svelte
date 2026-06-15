<script lang="ts">
  import type { Sequence, Track } from '$lib/project/types';
  import { commitPreview, editSequence, preview } from '$lib/project/store';
  import * as ops from '$lib/project/ops';
  import { AUDIO_TRACK_HEIGHT, VIDEO_TRACK_HEIGHT } from '$lib/project/defaults';
  import { contextMenu, type MenuItem } from '$lib/stores/app';
  import { MAX_TRACK_H, MIN_TRACK_H, kindIndex } from '$lib/editor/timeline-interactions';
  import Icon from '$lib/ui/Icon.svelte';

  let { track, seq }: { track: Track; seq: Sequence } = $props();

  let renaming = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  const defaultHeight = $derived(track.kind === 'video' ? VIDEO_TRACK_HEIGHT : AUDIO_TRACK_HEIGHT);
  // the smallest rows only have room for the name
  const compact = $derived(track.height < 34);

  $effect(() => {
    if (renaming && input) {
      input.focus();
      input.select();
    }
  });

  function toggle(label: string, key: 'hidden' | 'locked' | 'muted' | 'solo') {
    const id = track.id;
    editSequence(label, (s) => {
      const t = ops.trackById(s, id);
      if (t) t[key] = !t[key];
    });
  }

  function rename(name: string) {
    renaming = false;
    const id = track.id;
    if (!name.trim() || name.trim() === track.name) return;
    editSequence('rename track', (s) => ops.renameTrack(s, id, name));
  }

  function onrenamekey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') rename((e.currentTarget as HTMLInputElement).value);
    else if (e.key === 'Escape') renaming = false;
  }

  function setHeight(height: number, label = 'resize track') {
    const id = track.id;
    editSequence(label, (s) => {
      const t = ops.trackById(s, id);
      if (t) t.height = height;
    });
  }

  // the bottom edge drags the height, live through a preview so the lanes
  // follow without filling the history
  function onresizedown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const id = track.id;
    const startY = e.clientY;
    const startHeight = track.height;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const height = Math.round(Math.min(MAX_TRACK_H, Math.max(MIN_TRACK_H, startHeight + ev.clientY - startY)));
      if (height === track.height) return;
      moved = true;
      preview((d) => {
        const s = d.sequences.find((x) => x.id === seq.id);
        const t = s && ops.trackById(s, id);
        if (t) t.height = height;
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (moved) commitPreview('resize track');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  function addTrack(kind: 'video' | 'audio', where: 'above' | 'below') {
    const index = kindIndex(seq, track.id);
    // for video, above is the higher index; audio stacks downwards
    const at = kind !== track.kind ? undefined : kind === 'video' ? (where === 'above' ? index + 1 : index) : where === 'above' ? index : index + 1;
    editSequence(`add ${kind} track`, (s) => ops.addTrack(s, kind, at === undefined ? {} : { index: at }));
  }

  function oncontextmenu(e: MouseEvent) {
    e.preventDefault();
    const id = track.id;
    const same = seq.tracks.filter((t) => t.kind === track.kind).length;
    const items: MenuItem[] = [
      { label: 'Add video track above', action: () => addTrack('video', 'above') },
      { label: 'Add video track below', action: () => addTrack('video', 'below') },
      { label: 'Add audio track above', action: () => addTrack('audio', 'above') },
      { label: 'Add audio track below', action: () => addTrack('audio', 'below') },
      { label: '', separator: true },
      { label: 'Rename', action: () => (renaming = true) },
      {
        label: 'Track height',
        children: [
          { label: 'Small', checked: track.height <= 28, action: () => setHeight(28, 'track height') },
          { label: 'Medium', checked: track.height === defaultHeight, action: () => setHeight(defaultHeight, 'track height') },
          { label: 'Large', checked: track.height >= 96, action: () => setHeight(96, 'track height') }
        ]
      },
      { label: '', separator: true },
      {
        label: 'Delete track',
        danger: true,
        disabled: track.clips.length > 0 || track.locked || same <= 1,
        action: () => editSequence('delete track', (s) => ops.removeTrack(s, id))
      }
    ];
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }
</script>

<div
  class="track-header"
  class:audio={track.kind === 'audio'}
  class:compact
  class:locked={track.locked}
  style="height: {track.height}px"
  role="presentation"
  {oncontextmenu}>
  <div class="row">
    {#if renaming}
      <input
        class="rename"
        bind:this={input}
        value={track.name}
        spellcheck="false"
        onkeydown={onrenamekey}
        onblur={(e) => rename((e.currentTarget as HTMLInputElement).value)} />
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="name" ondblclick={() => (renaming = true)} title="Double-click to rename">{track.name}</span>
    {/if}
    <div class="toggles">
      {#if track.kind === 'video'}
        <button
          class="tl-icon-btn"
          class:on={!track.hidden}
          title={track.hidden ? 'Show track' : 'Hide track'}
          aria-pressed={!track.hidden}
          onclick={() => toggle(track.hidden ? 'show track' : 'hide track', 'hidden')}>
          <Icon name={track.hidden ? 'eyeOff' : 'eye'} size={12} />
        </button>
      {:else}
        <button
          class="tl-icon-btn"
          class:on={track.muted}
          title="Mute track"
          aria-pressed={track.muted}
          onclick={() => toggle(track.muted ? 'unmute track' : 'mute track', 'muted')}>M</button>
        <button
          class="tl-icon-btn"
          class:on={track.solo}
          title="Solo track"
          aria-pressed={track.solo}
          onclick={() => toggle(track.solo ? 'unsolo track' : 'solo track', 'solo')}>S</button>
      {/if}
      <button
        class="tl-icon-btn"
        class:on={track.locked}
        title={track.locked ? 'Unlock track' : 'Lock track'}
        aria-pressed={track.locked}
        onclick={() => toggle(track.locked ? 'unlock track' : 'lock track', 'locked')}>
        <Icon name={track.locked ? 'lock' : 'unlock'} size={12} />
      </button>
    </div>
  </div>
  <div
    class="resize"
    role="presentation"
    title="Drag to resize, double-click to reset"
    onpointerdown={onresizedown}
    ondblclick={() => setHeight(defaultHeight, 'reset track height')}></div>
</div>

<style>
  .track-header {
    position: relative;
    width: var(--track-header-w);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 4px 4px 4px 8px;
    background: var(--bg-surface);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    user-select: none;
    overflow: hidden;
  }

  .track-header.audio {
    background: var(--bg-surface);
  }

  .track-header.locked {
    color: var(--text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  /* on a short row the toggles sit beside the name, on a tall one under it */
  .track-header:not(.compact) .row {
    flex-direction: column;
    align-items: flex-start;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 16px;
    cursor: default;
  }

  .track-header:not(.compact) .name {
    width: 100%;
  }

  .rename {
    width: 100%;
    height: 16px;
    padding: 0 3px;
    font-size: 11px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-focus);
    outline: none;
  }

  .toggles {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .resize {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -2px;
    height: 5px;
    cursor: row-resize;
    z-index: 2;
  }

  .resize:hover {
    background: var(--accent-dim);
  }
</style>
