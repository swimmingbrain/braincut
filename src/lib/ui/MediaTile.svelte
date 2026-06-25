<script lang="ts" module>
  import type { Label } from '$lib/project/types';

  // the label palette in the order the menus show it. 'none' has no swatch
  export const labels: Label[] = [
    'violet', 'iris', 'caribbean', 'lavender', 'cerulean', 'forest', 'rose', 'mango',
    'purple', 'blue', 'teal', 'magenta', 'tan', 'green', 'brown', 'yellow'
  ];

  export function labelName(label: Label): string {
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  export function labelColor(label: Label): string {
    return label === 'none' ? 'transparent' : `var(--label-${label})`;
  }
</script>

<script lang="ts">
  import type { MediaItem } from '$lib/project/types';
  import { formatDuration } from '$lib/project/time';
  import { formatBytes } from '$lib/media/opfs';
  import Icon from './Icon.svelte';

  let {
    media,
    selected = false,
    view = 'icons',
    size = 96,
    progress = null,
    onclick,
    ondblclick,
    oncontextmenu,
    ondragstart,
    ondragend,
    onstatus
  }: {
    media: MediaItem;
    selected?: boolean;
    view?: 'icons' | 'list';
    size?: number;
    // 0..1 while a proxy is being made or the file is converting
    progress?: number | null;
    onclick: (e: MouseEvent) => void;
    ondblclick: () => void;
    oncontextmenu: (e: MouseEvent) => void;
    ondragstart: (e: DragEvent) => void;
    ondragend: () => void;
    onstatus: () => void;
  } = $props();

  const icon = $derived(media.kind === 'video' ? 'film' : media.kind === 'audio' ? 'audio' : 'image');
  const dimensions = $derived(media.width > 0 ? `${media.width}×${media.height}` : '');
  const fps = $derived(media.fps ? `${Number(media.fps.toFixed(3))} fps` : '');
  const codecs = $derived([media.videoCodec, media.audioCodec].filter(Boolean).join(' / ') || media.container || '');
  const duration = $derived(media.kind === 'image' ? 'still' : formatDuration(media.duration));
  const busy = $derived(media.status === 'converting' || progress !== null);

  function statusTitle(): string {
    if (media.status === 'missing') return media.statusReason ?? 'File missing, click to relink';
    if (media.status === 'unsupported') return media.statusReason ?? 'Not decodable here, click to convert';
    return 'Converting';
  }
</script>

<!-- keys are handled by the list that owns the selection -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="tile"
  class:selected
  class:list={view === 'list'}
  class:icons={view === 'icons'}
  class:missing={media.status === 'missing'}
  data-media-id={media.id}
  style="--tile-w: {size}px"
  role="option"
  aria-selected={selected}
  tabindex="-1"
  draggable="true"
  {onclick}
  {ondblclick}
  {oncontextmenu}
  {ondragstart}
  {ondragend}>
  <span class="label-strip" style="background: {labelColor(media.label)}"></span>

  <div class="thumb">
    {#if media.thumbnail}
      <img src={media.thumbnail} alt="" draggable="false" />
    {:else}
      <span class="thumb-icon"><Icon name={icon} size={view === 'list' ? 14 : 22} /></span>
    {/if}
    {#if view === 'icons' && media.kind !== 'image'}
      <span class="thumb-duration">{duration}</span>
    {/if}
    {#if media.proxy && !busy}
      <span class="thumb-proxy" title="Has a proxy">P</span>
    {/if}
  </div>

  {#if view === 'list'}
    <span class="cell name" title={media.name}>{media.name}</span>
    <span class="cell mono">{duration}</span>
    <span class="cell mono dim">{[dimensions, fps].filter(Boolean).join(' ')}</span>
    <span class="cell dim codec" title={codecs}>{codecs}</span>
    <span class="cell status">
      {#if busy}
        <span class="progress" title="Converting">
          <span class="progress-fill" style="width: {Math.round((progress ?? 0) * 100)}%"></span>
        </span>
      {:else if media.status === 'missing'}
        <button class="badge error" onclick={(e) => { e.stopPropagation(); onstatus(); }} title={statusTitle()}>missing</button>
      {:else if media.status === 'unsupported'}
        <button class="badge warning" onclick={(e) => { e.stopPropagation(); onstatus(); }} title={statusTitle()}>convert</button>
      {/if}
    </span>
  {:else}
    <div class="meta">
      <span class="name" title={media.name}>{media.name}</span>
      <span class="sub">{[dimensions, fps].filter(Boolean).join(' ') || codecs || formatBytes(media.fileSize)}</span>
    </div>
    {#if busy}
      <span class="progress floating" title="Converting">
        <span class="progress-fill" style="width: {Math.round((progress ?? 0) * 100)}%"></span>
      </span>
    {:else if media.status === 'missing'}
      <button class="badge error floating" onclick={(e) => { e.stopPropagation(); onstatus(); }} title={statusTitle()}>
        <Icon name="warning" size={10} /> missing
      </button>
    {:else if media.status === 'unsupported'}
      <button class="badge warning floating" onclick={(e) => { e.stopPropagation(); onstatus(); }} title={statusTitle()}>
        <Icon name="warning" size={10} /> convert
      </button>
    {/if}
  {/if}
</div>

<style>
  .tile {
    position: relative;
    display: flex;
    color: var(--text-secondary);
    cursor: default;
    user-select: none;
    outline: none;
  }

  .tile.icons {
    flex-direction: column;
    width: var(--tile-w);
    padding: 4px 4px 4px 7px;
    gap: 4px;
  }

  .tile.list {
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 8px 0 10px;
    font-size: 11.5px;
  }

  .tile:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tile.selected {
    background: var(--accent-dim);
    color: var(--text-primary);
  }

  .tile.missing .thumb {
    opacity: 0.4;
  }

  .label-strip {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
  }

  .thumb {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-deep);
    border: 1px solid var(--border);
    overflow: hidden;
    flex-shrink: 0;
  }

  .tile.icons .thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
  }

  .tile.list .thumb {
    width: 32px;
    height: 18px;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .thumb-icon {
    color: var(--text-muted);
    display: flex;
  }

  .thumb-duration,
  .thumb-proxy {
    position: absolute;
    bottom: 2px;
    font-family: var(--font-editor);
    font-size: 9.5px;
    line-height: 12px;
    padding: 0 3px;
    color: var(--text-primary);
    background: rgba(17, 17, 19, 0.85);
  }

  .thumb-duration {
    right: 2px;
  }

  .thumb-proxy {
    left: 2px;
    color: var(--accent);
  }

  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-size: 11.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub {
    font-family: var(--font-editor);
    font-size: 9.5px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cell {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
  }

  .cell.name {
    flex: 1 1 120px;
    min-width: 0;
  }

  .cell.mono {
    font-family: var(--font-editor);
    font-size: 10.5px;
    width: 64px;
  }

  .cell.dim {
    color: var(--text-muted);
  }

  .cell.mono.dim {
    width: 110px;
  }

  .cell.codec {
    width: 90px;
    font-size: 10.5px;
  }

  .cell.status {
    width: 58px;
    display: flex;
    justify-content: flex-end;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 5px;
    font-family: var(--font-editor);
    font-size: 9.5px;
    line-height: 12px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border: 1px solid;
  }

  .badge.error {
    color: var(--error);
    border-color: var(--error);
  }

  .badge.warning {
    color: var(--warning);
    border-color: var(--warning);
  }

  .badge:hover {
    background: var(--bg-elevated);
  }

  .floating {
    position: absolute;
    top: 8px;
    right: 8px;
  }

  .progress {
    display: block;
    width: 48px;
    height: 3px;
    background: var(--border);
  }

  .progress.floating {
    top: 10px;
  }

  .progress-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  @media (max-width: 480px) {
    .cell.codec,
    .cell.mono.dim {
      display: none;
    }
  }
</style>
