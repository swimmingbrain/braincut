<script lang="ts">
  import { activeSequence } from '$lib/project/store';
  import { renderStatus, playhead, snapEnabled, timelineZoom } from '$lib/stores/app';
  import { formatTimecode } from '$lib/project/time';
  import { sequenceDuration } from '$lib/project/defaults';
  import { fitZoom, timelineViewport } from '$lib/editor/timeline-interactions';

  const statusColors: Record<string, string> = {
    idle: 'var(--text-muted)',
    playing: 'var(--success)',
    rendering: 'var(--accent)',
    importing: 'var(--warning)',
    converting: 'var(--warning)'
  };

  const statusWords: Record<string, string> = {
    idle: 'Ready',
    playing: 'Playing',
    rendering: 'Rendering',
    importing: 'Importing',
    converting: 'Converting'
  };

  const fps = $derived($activeSequence?.fps ?? 25);
  const duration = $derived($activeSequence ? sequenceDuration($activeSequence) : 0);
  const clipCount = $derived(
    $activeSequence ? $activeSequence.tracks.reduce((sum, track) => sum + track.clips.length, 0) : 0
  );
  // the zoom store is pixels per second, which is not a percentage of
  // anything. 100 % is the zoom that fits the whole sequence in the lanes
  const pxPerSecond = $derived(Math.round($timelineZoom * 10) / 10);
  const fit = $derived($timelineViewport > 0 ? fitZoom(duration, $timelineViewport) : 0);
  const zoomPercent = $derived(fit > 0 ? Math.round(($timelineZoom / fit) * 100) : null);
</script>

<div class="status-bar">
  <div class="left">
    <span class="status-item">
      <span
        class="dot"
        class:pulse={$renderStatus !== 'idle'}
        style="background: {statusColors[$renderStatus]}"></span>
      {statusWords[$renderStatus]}
    </span>
    {#if $activeSequence}
      <span class="sep"></span>
      <span class="status-item timecode">
        {formatTimecode($playhead, fps)} / {formatTimecode(duration, fps)}
      </span>
      <span class="sep"></span>
      <span class="status-item">
        {$activeSequence.width}&#215;{$activeSequence.height}
        {fps.toFixed(fps % 1 === 0 ? 0 : 3)} fps
      </span>
    {/if}
  </div>

  <div class="right">
    {#if $activeSequence}
      <span class="status-item">{clipCount} {clipCount === 1 ? 'clip' : 'clips'}</span>
      <span class="sep"></span>
      <button
        class="status-item toggle"
        class:on={$snapEnabled}
        onclick={() => snapEnabled.update((s) => !s)}
        title="Toggle snapping (S)">
        snap {$snapEnabled ? 'on' : 'off'}
      </button>
      <span class="sep"></span>
      <span class="status-item zoom" title="{pxPerSecond} px per second of timeline{zoomPercent === null ? '' : ', 100% fits the sequence'}">
        {zoomPercent === null ? `${pxPerSecond} px/s` : `${zoomPercent}%`}
      </span>
      <span class="sep"></span>
    {/if}
    <span class="status-item credit">
      made with <span class="heart">&hearts;</span> by
      <a href="https://swimmingbrain.dev" target="_blank" rel="noopener">Braian Plaku</a>
    </span>
  </div>
</div>

<style>
  .status-bar {
    height: var(--statusbar-h);
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    font-size: 10.5px;
    color: var(--text-muted);
    flex-shrink: 0;
    user-select: none;
    font-family: var(--font-editor);
  }

  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .timecode {
    color: var(--text-secondary);
  }

  .sep {
    width: 1px;
    height: 10px;
    background: var(--border);
    margin: 0 4px;
  }

  .toggle {
    font-family: inherit;
    font-size: inherit;
    color: var(--text-muted);
    padding: 0 2px;
  }

  .toggle:hover {
    color: var(--text-secondary);
  }

  .toggle.on {
    color: var(--accent);
  }

  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    display: inline-block;
  }

  .pulse {
    animation: pulse 1.5s infinite;
  }

  .credit a {
    color: var(--accent);
    text-decoration: none;
  }

  .credit a:hover {
    color: var(--accent-hover);
  }

  .heart {
    color: var(--error);
    font-size: 11px;
  }

  @media (max-width: 900px) {
    .credit {
      display: none;
    }
  }
</style>
