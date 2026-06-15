<script lang="ts">
  import type { MediaItem, Track } from '$lib/project/types';
  import { clipsInRange } from '$lib/editor/timeline-interactions';
  import ClipView from './ClipView.svelte';
  import TransitionView from './TransitionView.svelte';

  let {
    track,
    zoom,
    scroll,
    viewStart,
    viewEnd,
    selection,
    selectedTransitionId,
    draggingIds,
    dropClipId,
    media,
    showThumbs,
    showWaves
  }: {
    track: Track;
    zoom: number;
    scroll: number;
    viewStart: number;
    viewEnd: number;
    selection: Set<string>;
    selectedTransitionId: string | null;
    draggingIds: Set<string>;
    dropClipId: string | null;
    media: Map<string, MediaItem>;
    showThumbs: boolean;
    showWaves: boolean;
  } = $props();

  // a quarter screen of margin on both sides keeps clips from popping in
  // at the edge while scrolling
  const margin = $derived((viewEnd - viewStart) * 0.25);
  const from = $derived(viewStart - margin);
  const to = $derived(viewEnd + margin);
  const clips = $derived(clipsInRange(track.clips, from, to));
  const transitions = $derived(track.transitions.filter((t) => t.start < to && t.start + t.duration > from));
  // clip contents only need the exact screen range, the margin would just decode more thumbnails
  const clipH = $derived(track.height - 1);
</script>

<div
  class="lane"
  class:audio={track.kind === 'audio'}
  class:hidden={track.hidden}
  data-track={track.id}
  style="height: {track.height}px">
  {#each clips as clip (clip.id)}
    <ClipView
      {clip}
      {track}
      media={clip.mediaId ? media.get(clip.mediaId) : undefined}
      {zoom}
      {scroll}
      {viewStart}
      {viewEnd}
      selected={selection.has(clip.id)}
      dragging={draggingIds.has(clip.id)}
      dropTarget={clip.id === dropClipId}
      {showThumbs}
      {showWaves}
      height={clipH} />
  {/each}
  {#each transitions as transition (transition.id)}
    <TransitionView {transition} {zoom} {scroll} selected={transition.id === selectedTransitionId} />
  {/each}
  {#if track.locked}
    <div class="locked tl-hatch"></div>
  {/if}
</div>

<style>
  .lane {
    position: relative;
    flex: 1;
    min-width: 0;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border);
    overflow: hidden;
  }

  .lane.audio {
    background: var(--bg-deep);
  }

  .lane.hidden {
    opacity: 0.5;
  }

  .locked {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 6;
  }
</style>
