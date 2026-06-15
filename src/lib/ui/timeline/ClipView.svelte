<script lang="ts" module>
  import { getBlobForMedia } from '$lib/media/sources';
  import type { MediaItem } from '$lib/project/types';

  // one blob lookup per media, shared by every clip that shows it
  const blobs = new Map<string, Promise<Blob | null>>();

  function blobFor(media: MediaItem): Promise<Blob | null> {
    const key = `${media.id}:${media.proxy?.key ?? ''}:${media.converted?.key ?? ''}`;
    let p = blobs.get(key);
    if (!p) {
      p = getBlobForMedia(media, { preferProxy: true }).catch(() => null);
      blobs.set(key, p);
    }
    return p;
  }

  const peaksRequested = new Set<string>();

  let waveColor: string | null = null;
  function waveformColor(): string {
    if (!waveColor) waveColor = getComputedStyle(document.documentElement).getPropertyValue('--clip-audio-edge').trim() || '#4fa37e';
    return waveColor;
  }

  const NAME_H = 14;
</script>

<script lang="ts">
  import type { Clip, Track } from '$lib/project/types';
  import { filmstripFrames } from '$lib/media/thumbnails';
  import { computePeaks, DEFAULT_PEAKS_PER_SECOND, getPeaks, peaksVersion } from '$lib/media/waveform';
  import { sourceTimeAt } from '$lib/engine/clip-time';
  import { bandKey, bandParam, bandValueToY, timeToX } from '$lib/editor/timeline-interactions';
  import Icon from '$lib/ui/Icon.svelte';

  let {
    clip,
    track,
    media,
    zoom,
    scroll,
    viewStart,
    viewEnd,
    selected,
    dragging,
    dropTarget,
    showThumbs,
    showWaves,
    height
  }: {
    clip: Clip;
    track: Track;
    media: MediaItem | undefined;
    zoom: number;
    scroll: number;
    viewStart: number;
    viewEnd: number;
    selected: boolean;
    dragging: boolean;
    dropTarget: boolean;
    showThumbs: boolean;
    showWaves: boolean;
    height: number;
  } = $props();

  const x = $derived(timeToX(clip.start, zoom, scroll));
  const width = $derived(Math.max(1, clip.duration * zoom));
  const end = $derived(clip.start + clip.duration);
  // the part of the clip on screen, everything drawn on a canvas covers only this
  const vs = $derived(Math.max(clip.start, viewStart));
  const ve = $derived(Math.min(end, viewEnd));
  const visibleLeft = $derived((vs - clip.start) * zoom);
  const visibleWidth = $derived(Math.max(0, Math.ceil((ve - vs) * zoom)));
  const bodyH = $derived(Math.max(0, height - NAME_H - 2));
  const showBody = $derived(bodyH >= 8);
  const missing = $derived(media?.status === 'missing');
  const hasFx = $derived(clip.effects.some((e) => !e.fixed));

  const band = $derived.by(() => {
    const key = bandKey(clip);
    const { effectType, param } = bandParam(key);
    const effect = clip.effects.find((e) => e.type === effectType);
    const value = typeof effect?.params[param] === 'number' ? (effect.params[param] as number) : key === 'opacity' ? 100 : 0;
    const keyframes = effect?.keyframes[param] ?? [];
    return { key, param, value, keyframes };
  });

  // the band as a polyline in the coordinates of the visible canvas
  const bandPath = $derived.by(() => {
    const { key, value, keyframes } = band;
    if (visibleWidth <= 0) return '';
    if (keyframes.length === 0) {
      const y = bandValueToY(key, value, bodyH);
      return `M0 ${y} H${visibleWidth}`;
    }
    const px = (t: number) => (clip.start + t - vs) * zoom;
    const py = (v: unknown) => bandValueToY(key, typeof v === 'number' ? v : value, bodyH);
    let d = `M0 ${py(keyframes[0].value)}`;
    for (const kf of keyframes) d += ` L${px(kf.time)} ${py(kf.value)}`;
    d += ` L${visibleWidth} ${py(keyframes[keyframes.length - 1].value)}`;
    return d;
  });

  let strip = $state<HTMLCanvasElement | null>(null);
  let wave = $state<HTMLCanvasElement | null>(null);

  // thumbnails sit on a fixed grid of slots along the clip, so scrolling
  // never reshuffles them. a slot is about one thumbnail wide
  const thumbW = $derived(media && media.height > 0 ? Math.max(16, Math.round(bodyH * (media.width / media.height))) : 64);
  const slot = $derived(Math.max(48, thumbW));
  const firstSlot = $derived(Math.floor(visibleLeft / slot));
  const lastSlot = $derived(Math.min(firstSlot + 64, Math.ceil((visibleLeft + visibleWidth) / slot)));
  const wantStrip = $derived(showBody && showThumbs && clip.kind === 'video' && !!media?.hasVideo && !missing && visibleWidth > 0);
  const stripLeft = $derived(firstSlot * slot);
  const stripWidth = $derived(Math.max(0, (lastSlot - firstSlot) * slot));

  let stripGeneration = 0;

  $effect(() => {
    if (!wantStrip || !strip || !media) return;
    // read everything that should trigger a redraw, then debounce the decode
    const deps = [firstSlot, lastSlot, slot, clip.in, clip.speed, clip.reverse, clip.start, bodyH, media.id, zoom];
    void deps;
    const generation = ++stripGeneration;
    const canvas = strip;
    const m = media;
    const timer = setTimeout(async () => {
      const times: number[] = [];
      for (let i = firstSlot; i < lastSlot; i++) {
        times.push(sourceTimeAt(clip, clip.start + ((i + 0.5) * slot) / zoom, m.duration));
      }
      const blob = await blobFor(m);
      if (!blob || generation !== stripGeneration) return;
      const frames = await filmstripFrames(m, blob, { times, width: thumbW });
      if (generation !== stripGeneration) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = stripWidth;
      canvas.height = bodyH;
      ctx.clearRect(0, 0, stripWidth, bodyH);
      frames.forEach((frame, i) => {
        if (!frame) return;
        const dw = (bodyH * frame.width) / frame.height;
        ctx.drawImage(frame, i * slot, 0, dw, bodyH);
      });
    }, 120);
    return () => clearTimeout(timer);
  });

  const wantWave = $derived(showBody && showWaves && clip.kind === 'audio' && !!media?.hasAudio && !missing && visibleWidth > 0);

  $effect(() => {
    if (!wantWave || !wave || !media) return;
    const version = $peaksVersion;
    void version;
    const peaks = getPeaks(media.id);
    if (!peaks) {
      if (!peaksRequested.has(media.id)) {
        peaksRequested.add(media.id);
        const m = media;
        blobFor(m).then((blob) => {
          if (blob) computePeaks(m, blob).catch(() => peaksRequested.delete(m.id));
          else peaksRequested.delete(m.id);
        });
      }
      return;
    }
    const canvas = wave;
    const w = visibleWidth;
    const h = bodyH;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = waveformColor();
    const per = DEFAULT_PEAKS_PER_SECOND;
    const buckets = peaks.length / 2;
    const mid = h / 2;
    const dur = media.duration;
    for (let px = 0; px < w; px++) {
      const a = sourceTimeAt(clip, vs + px / zoom, dur);
      const b = sourceTimeAt(clip, vs + (px + 1) / zoom, dur);
      const lo = Math.max(0, Math.floor(Math.min(a, b) * per));
      const hi = Math.min(buckets, Math.max(lo + 1, Math.ceil(Math.max(a, b) * per)));
      if (lo >= buckets) continue;
      let mn = 1;
      let mx = -1;
      for (let i = lo; i < hi; i++) {
        if (peaks[2 * i] < mn) mn = peaks[2 * i];
        if (peaks[2 * i + 1] > mx) mx = peaks[2 * i + 1];
      }
      const top = mid - mx * mid;
      const bottom = mid - mn * mid;
      ctx.fillRect(px, top, 1, Math.max(1, bottom - top));
    }
  });
</script>

<div
  class="clip kind-{clip.kind}"
  class:selected
  class:disabled={!clip.enabled}
  class:dragging
  class:drop-target={dropTarget}
  class:missing
  class:locked={track.locked}
  data-clip={clip.id}
  style="transform: translateX({x}px); width: {width}px; height: {height}px"
  title={clip.name}>
  {#if clip.label !== 'none'}
    <div class="label" style="background: var(--label-{clip.label})"></div>
  {/if}
  <div class="name-bar">
    {#if clip.linkId}
      <span class="glyph" title="Linked"><Icon name="link" size={10} /></span>
    {/if}
    <span class="name">{clip.name}</span>
    {#if hasFx}
      <span class="glyph fx" title="Has effects"><Icon name="fx" size={10} /></span>
    {/if}
  </div>
  {#if showBody}
    <div class="body" style="height: {bodyH}px">
      {#if clip.kind === 'color'}
        <div class="swatch" style="background: {clip.color ?? '#000'}"></div>
      {:else if clip.kind === 'adjustment'}
        <div class="adjust tl-hatch"></div>
      {:else if clip.kind === 'title'}
        <div class="title-text">{clip.title?.text ?? ''}</div>
      {:else if clip.kind === 'image' && showThumbs && media?.thumbnail}
        <img class="still" src={media.thumbnail} alt="" style="left: {visibleLeft}px; height: {bodyH}px" draggable="false" />
      {/if}
      {#if wantStrip}
        <canvas class="strip" bind:this={strip} style="left: {stripLeft}px; width: {stripWidth}px; height: {bodyH}px"></canvas>
      {/if}
      {#if wantWave}
        <canvas class="wave" bind:this={wave} style="left: {visibleLeft}px; width: {visibleWidth}px; height: {bodyH}px"></canvas>
      {/if}
      {#if visibleWidth > 0}
        <svg class="band" style="left: {visibleLeft}px" width={visibleWidth} height={bodyH} viewBox="0 0 {visibleWidth} {bodyH}">
          <path class="band-hit" d={bandPath} data-band={band.key} />
          <path class="band-line" d={bandPath} />
          {#each band.keyframes as kf (kf.time)}
            <circle
              class="kf"
              data-kf={kf.time}
              cx={(clip.start + kf.time - vs) * zoom}
              cy={bandValueToY(band.key, typeof kf.value === 'number' ? kf.value : band.value, bodyH)}
              r="3.5" />
          {/each}
        </svg>
      {/if}
    </div>
  {/if}
  <div class="clip-edge head"></div>
  <div class="clip-edge tail"></div>
</div>

<style>
  .clip {
    position: absolute;
    top: 0;
    left: 0;
    overflow: hidden;
    background: var(--clip-bg);
    border: 1px solid var(--clip-edge);
    border-top-width: 1px;
    box-sizing: border-box;
    user-select: none;
    will-change: transform;
    --clip-bg: var(--clip-video);
    --clip-edge: var(--clip-video-edge);
  }

  .kind-audio {
    --clip-bg: var(--clip-audio);
    --clip-edge: var(--clip-audio-edge);
  }

  .kind-image {
    --clip-bg: var(--clip-image);
    --clip-edge: var(--clip-image-edge);
  }

  .kind-title {
    --clip-bg: var(--clip-title);
    --clip-edge: var(--clip-title-edge);
  }

  .kind-color {
    --clip-bg: var(--clip-color);
    --clip-edge: var(--clip-color-edge);
  }

  .kind-adjustment {
    --clip-bg: var(--clip-adjustment);
    --clip-edge: var(--clip-adjustment-edge);
  }

  .clip.selected {
    border-color: var(--clip-selected);
    box-shadow: inset 0 0 0 1px var(--clip-selected);
  }

  .clip.disabled {
    opacity: 0.45;
  }

  .clip.drop-target {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent), inset 0 0 0 100px var(--accent-dim);
  }

  .clip.dragging {
    opacity: 0.35;
  }

  .clip.locked {
    filter: saturate(0.4);
  }

  .label {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    z-index: 2;
  }

  .name-bar {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 14px;
    padding: 0 4px 0 5px;
    background: rgba(0, 0, 0, 0.28);
    overflow: hidden;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-family: var(--font-editor);
    font-size: 10.5px;
    line-height: 14px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .missing .name {
    color: var(--error);
  }

  .glyph {
    display: flex;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .glyph.fx {
    color: var(--accent);
  }

  .body {
    position: relative;
    overflow: hidden;
  }

  .strip,
  .wave,
  .still {
    position: absolute;
    top: 0;
    display: block;
    pointer-events: none;
  }

  .strip {
    opacity: 0.85;
  }

  .swatch {
    position: absolute;
    inset: 2px 3px;
    opacity: 0.75;
  }

  .adjust {
    position: absolute;
    inset: 0;
  }

  .title-text {
    padding: 2px 5px;
    font-size: 10px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .band {
    position: absolute;
    top: 0;
    overflow: visible;
  }

  .band-line {
    fill: none;
    stroke: rgba(255, 255, 255, 0.7);
    stroke-width: 1;
    pointer-events: none;
  }

  .band-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 9;
    pointer-events: stroke;
    cursor: ns-resize;
  }

  .kf {
    fill: var(--bg-deep);
    stroke: var(--text-primary);
    stroke-width: 1;
    cursor: move;
  }

  .kf:hover {
    fill: var(--accent);
  }

  .clip-edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    z-index: 3;
  }

  .clip-edge.head {
    left: 0;
  }

  .clip-edge.tail {
    right: 0;
  }

  .clip:hover .clip-edge {
    background: rgba(255, 255, 255, 0.08);
  }
</style>
