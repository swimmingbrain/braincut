<script lang="ts">
  import { onMount } from 'svelte';
  import { sessionEpoch, source, type Session } from '$lib/engine/session';
  import { endDrag, startDrag } from '$lib/editor/drag';
  import { insertSource, overwriteSource, sourceRange } from '$lib/editor/source-actions';
  import { activeSequence, mediaById } from '$lib/project/store';
  import { snapToFrame } from '$lib/project/time';
  import { sourceMedia } from '$lib/stores/app';
  import { preferences } from '$lib/stores/preferences';
  import Icon from './Icon.svelte';
  import Monitor from './Monitor.svelte';
  import Transport from './Transport.svelte';

  let session = $state<Session | null>(null);

  onMount(() => {
    // a preview reset replaces the session, this picks up the new one
    return sessionEpoch.subscribe(() => {
      session = source();
    });
  });

  const media = $derived($sourceMedia ? $mediaById.get($sourceMedia.mediaId) ?? null : null);
  const fps = $derived(media?.fps ?? $activeSequence?.fps ?? 30);
  // stills have no length of their own, they show for the preference duration
  const duration = $derived(media ? (media.kind === 'image' ? $preferences.stillImageDuration : media.duration) : 0);

  function markIn() {
    const s = session;
    if (!s) return;
    const t = snapToFrame(s.player.currentTime(), fps);
    sourceMedia.update((v) => (v ? { ...v, in: t, out: Math.max(v.out, t) } : v));
  }

  function markOut() {
    const s = session;
    if (!s) return;
    const t = snapToFrame(s.player.currentTime(), fps);
    sourceMedia.update((v) => (v ? { ...v, out: t, in: Math.min(v.in, t) } : v));
  }

  function drag(e: DragEvent, only?: 'video' | 'audio') {
    const m = media;
    if (!m) return;
    const { in: inPoint, out } = sourceRange(m);
    startDrag({ kind: 'source', mediaId: m.id, in: inPoint, out, only }, e);
  }
</script>

<div class="source">
  {#if session && media && $sourceMedia}
    <div class="header">
      <span class="title"><span class="name">{media.name}</span> Source</span>
      <div class="controls">
        <button class="hbtn text" title="Insert at playhead (,)" onclick={() => insertSource()}>Insert</button>
        <button class="hbtn text" title="Overwrite at playhead (.)" onclick={() => overwriteSource()}>Overwrite</button>
      </div>
    </div>
    <Monitor {session} draggable ondragstart={(e) => drag(e)} ondragend={endDrag} />
    <Transport
      player={session.player}
      {fps}
      {duration}
      inPoint={$sourceMedia.in}
      outPoint={$sourceMedia.out > $sourceMedia.in ? $sourceMedia.out : null}
      onmarkin={markIn}
      onmarkout={markOut}
      compact />
    <div class="handles">
      <span class="hint">Drag to the timeline</span>
      {#if media.hasVideo || media.kind === 'image'}
        <span class="grip" draggable="true" role="button" tabindex="-1" title="Drag video only" ondragstart={(e) => drag(e, 'video')} ondragend={endDrag}>
          <Icon name="film" size={13} />
        </span>
      {/if}
      {#if media.hasAudio}
        <span class="grip" draggable="true" role="button" tabindex="-1" title="Drag audio only" ondragstart={(e) => drag(e, 'audio')} ondragend={endDrag}>
          <Icon name="audio" size={13} />
        </span>
      {/if}
    </div>
  {:else}
    <div class="header">
      <span class="title">Source</span>
    </div>
    <div class="empty">Double-click a clip in the Project panel to open it here</div>
  {/if}
</div>

<style>
  .source {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-surface);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 32px;
    padding: 0 4px 0 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .title {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .name {
    color: var(--text-primary);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .hbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .hbtn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .handles {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    height: 24px;
    padding: 0 4px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }

  .hint {
    flex: 1;
    font-size: 10.5px;
    color: var(--text-muted);
    padding-left: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .grip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 20px;
    color: var(--text-secondary);
    cursor: grab;
  }

  .grip:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    text-align: center;
    font-size: 11.5px;
    color: var(--text-muted);
    background: #000;
  }
</style>
