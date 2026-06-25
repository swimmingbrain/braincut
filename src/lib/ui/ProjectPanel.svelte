<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { browser } from '$app/environment';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import MediaTile, { labels, labelName } from './MediaTile.svelte';
  import type { Bin, Id, Label, MediaItem, Sequence } from '$lib/project/types';
  import { activeSequence, edit, editSequence, project, setActiveSequence } from '$lib/project/store';
  import { createAdjustmentClip, createClipFromMedia, createColorClip, createSequence, createTitleClip } from '$lib/project/defaults';
  import { overwriteClip, placeClips, validateTransitions, type Placement } from '$lib/project/ops';
  import { id as newId } from '$lib/project/ids';
  import { addToast, contextMenu, dialog, dragPayload, importProgress, leftPanelTab, playhead, sourceMedia, type MenuItem } from '$lib/stores/app';
  import { preferences } from '$lib/stores/preferences';
  import { pickFiles, pickFolder } from '$lib/media/import';
  import { forgetSource, getBlob } from '$lib/media/sources';
  import { createProxy, proxyStatus, removeProxy } from '$lib/media/proxy';
  import { convertForEditing, ffmpegAvailable } from '$lib/media/transcode';
  import { endDrag, readDrag, startDrag } from '$lib/editor/drag';

  type View = 'icons' | 'list';
  type SortKey = 'name' | 'duration' | 'added';

  const VIEW_KEY = 'braincut-project-view';

  function storedView(): View {
    if (!browser) return 'icons';
    try {
      return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'icons';
    } catch {
      return 'icons';
    }
  }

  let query = $state('');
  let view = $state<View>(storedView());
  let sortKey = $state<SortKey>('added');
  let sortAsc = $state(true);
  let selected = $state<Set<Id>>(new Set());
  let lastPicked = $state<Id | null>(null);
  let collapsed = $state<Set<Id>>(new Set());
  let dropBin = $state<Id | null | 'root'>(null);
  let converting = $state<Map<Id, number>>(new Map());
  let list = $state<HTMLDivElement | null>(null);
  let dragGhost: HTMLElement | null = null;

  const media = $derived($project?.media ?? []);
  const bins = $derived($project?.bins ?? []);
  const sequences = $derived($project?.sequences ?? []);
  const needle = $derived(query.trim().toLowerCase());

  const sorted = $derived.by(() => {
    const items = needle ? media.filter((m) => m.name.toLowerCase().includes(needle)) : [...media];
    const dir = sortAsc ? 1 : -1;
    items.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'duration') return (a.duration - b.duration) * dir;
      return (a.addedAt - b.addedAt) * dir;
    });
    return items;
  });

  const visibleSequences = $derived(needle ? sequences.filter((s) => s.name.toLowerCase().includes(needle)) : sequences);
  const rootBins = $derived(bins.filter((b) => b.parentId === null || !bins.some((p) => p.id === b.parentId)));

  function inBin(binId: Id | null): MediaItem[] {
    return sorted.filter((m) => (m.binId ?? null) === binId);
  }

  function childBins(binId: Id): Bin[] {
    return bins.filter((b) => b.parentId === binId);
  }

  // a search flattens the tree: a hit inside a closed bin still has to show
  function isOpen(binId: Id): boolean {
    return needle !== '' || !collapsed.has(binId);
  }

  function toggleBin(binId: Id) {
    const next = new Set(collapsed);
    if (next.has(binId)) next.delete(binId);
    else next.add(binId);
    collapsed = next;
  }

  function setView(next: View) {
    view = next;
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  }

  function sortBy(key: SortKey) {
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = true;
    }
  }

  function pick(id: Id, e: MouseEvent) {
    const next = new Set(e.ctrlKey || e.metaKey ? selected : []);
    if (e.shiftKey && lastPicked) {
      // shift selects the run between the two in display order, like every file browser
      const order = [...sorted.map((m) => m.id), ...sequences.map((s) => s.id)];
      const a = order.indexOf(lastPicked);
      const b = order.indexOf(id);
      if (a !== -1 && b !== -1) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(order[i]);
      } else next.add(id);
    } else if ((e.ctrlKey || e.metaKey) && next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      lastPicked = id;
    }
    selected = next;
  }

  function clearSelected() {
    if (selected.size > 0) selected = new Set();
  }

  function selectedMediaIds(): Id[] {
    return media.filter((m) => selected.has(m.id)).map((m) => m.id);
  }

  function openInSource(item: MediaItem) {
    sourceMedia.set({ mediaId: item.id, in: 0, out: item.duration, time: 0 });
    leftPanelTab.set('source');
  }

  function clipsUsing(mediaIds: Id[]): number {
    const wanted = new Set(mediaIds);
    let count = 0;
    for (const seq of sequences) for (const track of seq.tracks) for (const clip of track.clips) {
      if (clip.mediaId && wanted.has(clip.mediaId)) count++;
    }
    return count;
  }

  function removeMedia(mediaIds: Id[]) {
    if (mediaIds.length === 0) return;
    const used = clipsUsing(mediaIds);
    if (used > 0) {
      const what = mediaIds.length === 1 ? 'This item is' : 'These items are';
      if (!confirm(`${what} used by ${used} ${used === 1 ? 'clip' : 'clips'} in the timeline. Remove the media and those clips?`)) return;
    }
    const wanted = new Set(mediaIds);
    edit('remove media', (draft) => {
      draft.media = draft.media.filter((m) => !wanted.has(m.id));
      for (const seq of draft.sequences) {
        for (const track of seq.tracks) track.clips = track.clips.filter((c) => !c.mediaId || !wanted.has(c.mediaId));
        validateTransitions(seq);
      }
    });
    const src = get(sourceMedia);
    if (src && wanted.has(src.mediaId)) sourceMedia.set(null);
    for (const mid of mediaIds) forgetSource(mid);
    selected = new Set([...selected].filter((sid) => !wanted.has(sid)));
  }

  function setLabel(mediaIds: Id[], label: Label) {
    const wanted = new Set(mediaIds);
    edit('label media', (draft) => {
      for (const m of draft.media) if (wanted.has(m.id)) m.label = label;
    });
  }

  function moveToBin(mediaIds: Id[], binId: Id | null) {
    const wanted = new Set(mediaIds);
    edit('move to bin', (draft) => {
      for (const m of draft.media) if (wanted.has(m.id)) m.binId = binId;
    });
  }

  async function makeProxy(item: MediaItem) {
    const blob = await getBlob(item.id);
    if (!blob) {
      addToast('The file is not available, relink it first', 'warning');
      return;
    }
    try {
      await createProxy(item, blob);
      addToast(`Proxy ready for ${item.name}`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not create the proxy', 'error');
    }
  }

  async function convert(item: MediaItem) {
    if (!ffmpegAvailable()) {
      addToast('Converting is turned off. Set a mirror for the converter in the preferences to enable it.', 'warning', 6000);
      return;
    }
    const blob = await getBlob(item.id);
    if (!blob) {
      addToast('The file is not available, relink it first', 'warning');
      return;
    }
    const setProgress = (value: number | null) => {
      const next = new Map(converting);
      if (value === null) next.delete(item.id);
      else next.set(item.id, value);
      converting = next;
    };
    setProgress(0);
    try {
      await convertForEditing(item, blob, setProgress);
      addToast(`${item.name} converted`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Conversion failed', 'error');
    } finally {
      setProgress(null);
    }
  }

  function onStatus(item: MediaItem) {
    if (item.status === 'missing') dialog.set({ kind: 'relink', mediaId: item.id });
    else if (item.status === 'unsupported') convert(item);
  }

  function sequenceFromMedia(item: MediaItem) {
    const hasPicture = item.width > 0 && item.height > 0;
    const seq = createSequence({
      name: item.name.replace(/\.[^.]+$/, ''),
      width: hasPicture ? item.width : 1920,
      height: hasPicture ? item.height : 1080,
      fps: item.fps ?? 30
    });
    const clips = createClipFromMedia(item, 0, { fps: seq.fps, stillDuration: $preferences.stillImageDuration });
    const video = seq.tracks.find((t) => t.kind === 'video')!;
    const audio = seq.tracks.find((t) => t.kind === 'audio')!;
    const placements: Placement[] = [];
    if (clips.video) placements.push({ trackId: video.id, clip: clips.video });
    if (clips.audio) placements.push({ trackId: audio.id, clip: clips.audio });
    placeClips(seq, placements, 'overwrite');
    edit('new sequence from clip', (draft) => {
      draft.sequences.push(seq);
    });
    setActiveSequence(seq.id);
  }

  function mediaMenu(item: MediaItem): MenuItem[] {
    const ids = selected.has(item.id) ? selectedMediaIds() : [item.id];
    const many = ids.length > 1;
    const busy = item.status === 'converting' || converting.has(item.id) || $proxyStatus.has(item.id);
    return [
      { label: 'Open in source monitor', action: () => openInSource(item), disabled: many },
      { label: 'Rename…', action: () => dialog.set({ kind: 'rename', target: 'media', id: item.id }), disabled: many },
      {
        label: 'Label',
        children: [
          { label: 'None', checked: item.label === 'none', action: () => setLabel(ids, 'none') },
          ...labels.map((l) => ({ label: labelName(l), checked: item.label === l, action: () => setLabel(ids, l) }))
        ]
      },
      { label: 'New sequence from clip', action: () => sequenceFromMedia(item), disabled: many || item.status !== 'ready' },
      { separator: true, label: '' },
      item.proxy
        ? { label: 'Remove proxy', action: () => removeProxy(item), disabled: many }
        : { label: 'Create proxy', action: () => makeProxy(item), disabled: many || busy || item.kind !== 'video' || item.status !== 'ready' },
      ...(item.status === 'unsupported'
        ? [{ label: 'Convert for editing', action: () => convert(item), disabled: many || busy || !ffmpegAvailable() }]
        : []),
      { label: 'Relink…', action: () => dialog.set({ kind: 'relink', mediaId: item.id }), disabled: many },
      { separator: true, label: '' },
      { label: many ? `Remove ${ids.length} items` : 'Remove', danger: true, action: () => removeMedia(ids) }
    ];
  }

  function sequenceMenu(seq: Sequence): MenuItem[] {
    return [
      { label: 'Open', action: () => setActiveSequence(seq.id) },
      { label: 'Rename…', action: () => dialog.set({ kind: 'rename', target: 'sequence', id: seq.id }) },
      { label: 'Duplicate', action: () => duplicateSequence(seq) },
      {
        label: 'Sequence settings…',
        action: () => {
          setActiveSequence(seq.id);
          dialog.set({ kind: 'sequence-settings' });
        }
      },
      { separator: true, label: '' },
      { label: 'Delete', danger: true, disabled: sequences.length <= 1, action: () => deleteSequence(seq) }
    ];
  }

  function binMenu(bin: Bin): MenuItem[] {
    return [
      { label: 'Import into bin…', action: () => pickFiles({ binId: bin.id }) },
      { label: 'New bin inside', action: () => newBin(bin.id) },
      { label: 'Rename…', action: () => dialog.set({ kind: 'rename', target: 'bin', id: bin.id }) },
      { separator: true, label: '' },
      { label: 'Delete bin', danger: true, action: () => deleteBin(bin) }
    ];
  }

  function duplicateSequence(seq: Sequence) {
    // fresh ids all the way down, otherwise the two share clips in every map keyed by id
    const copy: Sequence = JSON.parse(JSON.stringify(seq));
    copy.id = newId();
    copy.name = `${seq.name} copy`;
    const links = new Map<Id, Id>();
    for (const track of copy.tracks) {
      track.id = newId();
      const clipIds = new Map<Id, Id>();
      for (const clip of track.clips) {
        const next = newId();
        clipIds.set(clip.id, next);
        clip.id = next;
        if (clip.linkId) {
          const mapped = links.get(clip.linkId) ?? newId();
          links.set(clip.linkId, mapped);
          clip.linkId = mapped;
        }
        for (const fx of clip.effects) fx.id = newId();
      }
      for (const t of track.transitions) {
        t.id = newId();
        t.leftClipId = t.leftClipId ? clipIds.get(t.leftClipId) ?? null : null;
        t.rightClipId = t.rightClipId ? clipIds.get(t.rightClipId) ?? null : null;
      }
    }
    for (const m of copy.markers) m.id = newId();
    edit('duplicate sequence', (draft) => {
      const at = draft.sequences.findIndex((s) => s.id === seq.id);
      draft.sequences.splice(at + 1, 0, copy);
    });
  }

  function deleteSequence(seq: Sequence) {
    if (sequences.length <= 1) return;
    if (!confirm(`Delete the sequence "${seq.name}"? This can be undone.`)) return;
    edit('delete sequence', (draft) => {
      draft.sequences = draft.sequences.filter((s) => s.id !== seq.id);
      if (draft.activeSequenceId === seq.id) draft.activeSequenceId = draft.sequences[0]?.id ?? null;
    });
  }

  function newBin(parentId: Id | null = null) {
    const bin: Bin = { id: newId(), name: 'New bin', parentId };
    edit('new bin', (draft) => {
      draft.bins.push(bin);
    });
    dialog.set({ kind: 'rename', target: 'bin', id: bin.id });
  }

  function deleteBin(bin: Bin) {
    // the media inside moves up a level, deleting a folder never deletes footage
    edit('delete bin', (draft) => {
      const gone = new Set<Id>([bin.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const b of draft.bins) if (b.parentId && gone.has(b.parentId) && !gone.has(b.id)) {
          gone.add(b.id);
          grew = true;
        }
      }
      draft.bins = draft.bins.filter((b) => !gone.has(b.id));
      for (const m of draft.media) if (m.binId && gone.has(m.binId)) m.binId = bin.parentId;
    });
  }

  function addGenerated(kind: 'title' | 'color' | 'adjustment') {
    const seq = $activeSequence;
    if (!seq) return;
    const track = [...seq.tracks].reverse().find((t) => t.kind === 'video' && !t.locked);
    if (!track) {
      addToast('No unlocked video track to put it on', 'warning');
      return;
    }
    const duration = $preferences.stillImageDuration;
    const at = $playhead;
    const clip = kind === 'title' ? createTitleClip(at, duration) : kind === 'color' ? createColorClip(at, duration, '#000000') : createAdjustmentClip(at, duration);
    editSequence(`add ${clip.name.toLowerCase()}`, (s) => {
      overwriteClip(s, track.id, clip, at);
    });
    if (kind === 'title') dialog.set({ kind: 'title', clipId: clip.id });
  }

  const addMenu: MenuItem[] = [
    { label: 'Title', action: () => addGenerated('title') },
    { label: 'Color matte', action: () => addGenerated('color') },
    { label: 'Adjustment layer', action: () => addGenerated('adjustment') },
    { separator: true, label: '' },
    { label: 'Sequence…', shortcut: 'Ctrl+N', action: () => dialog.set({ kind: 'new-sequence' }) },
    { label: 'Bin', action: () => newBin() }
  ];

  function openMenu(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu.set({ x: e.clientX, y: e.clientY, items });
  }

  function onTileDragStart(item: MediaItem, e: DragEvent) {
    if (!selected.has(item.id)) {
      selected = new Set([item.id]);
      lastPicked = item.id;
    }
    const ids = selectedMediaIds();
    startDrag({ kind: 'media', mediaIds: ids }, e);
    if (!e.dataTransfer) return;
    // a small card follows the pointer instead of the whole tile
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = ids.length > 1 ? `${ids.length} items` : item.name;
    Object.assign(ghost.style, {
      position: 'fixed', top: '-100px', left: '0', padding: '3px 8px', fontSize: '11px',
      fontFamily: 'var(--font-ui)', color: 'var(--text-primary)', background: 'var(--bg-elevated)',
      border: '1px solid var(--accent)', whiteSpace: 'nowrap', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis'
    });
    document.body.appendChild(ghost);
    dragGhost = ghost;
    e.dataTransfer.setDragImage(ghost, -8, 12);
  }

  function onTileDragEnd() {
    dragGhost?.remove();
    dragGhost = null;
    endDrag();
  }

  function binDragOver(e: DragEvent, target: Id | 'root') {
    if ($dragPayload?.kind !== 'media') return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dropBin !== target) dropBin = target;
  }

  function binDrop(e: DragEvent, target: Id | null) {
    const payload = readDrag(e);
    dropBin = null;
    if (payload?.kind !== 'media') return;
    e.preventDefault();
    e.stopPropagation();
    moveToBin(payload.mediaIds, target);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const ids = selectedMediaIds();
      if (ids.length > 0) {
        e.preventDefault();
        removeMedia(ids);
      }
      return;
    }
    if (e.key === 'Enter' && selected.size === 1) {
      const item = media.find((m) => selected.has(m.id));
      if (item) openInSource(item);
      const seq = sequences.find((s) => selected.has(s.id));
      if (seq) setActiveSequence(seq.id);
    } else if (e.key === 'Escape') {
      clearSelected();
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      selected = new Set(media.map((m) => m.id));
    }
  }

  function reveal(mediaId: Id) {
    const item = media.find((m) => m.id === mediaId);
    if (!item) return;
    if (item.binId) {
      const next = new Set(collapsed);
      let bin = bins.find((b) => b.id === item.binId);
      while (bin) {
        next.delete(bin.id);
        bin = bins.find((b) => b.id === bin?.parentId);
      }
      collapsed = next;
    }
    selected = new Set([mediaId]);
    lastPicked = mediaId;
    requestAnimationFrame(() => {
      list?.querySelector<HTMLElement>(`[data-media-id="${mediaId}"]`)?.scrollIntoView({ block: 'nearest' });
    });
  }

  onMount(() => {
    const handler = (e: Event) => reveal((e as CustomEvent<{ mediaId: string }>).detail.mediaId);
    window.addEventListener('braincut:reveal-media', handler);
    return () => window.removeEventListener('braincut:reveal-media', handler);
  });

  const importPercent = $derived($importProgress && $importProgress.total > 0 ? Math.round(($importProgress.done / $importProgress.total) * 100) : 0);
</script>

<div class="project-panel">
  <div class="toolbar">
    <label class="search">
      <Icon name="search" size={12} />
      <input type="search" placeholder="Search" bind:value={query} spellcheck="false" aria-label="Search media" onkeydown={(e) => e.stopPropagation()} />
    </label>
    <div class="view-toggle" role="group" aria-label="View">
      <button class="tool-btn" class:active={view === 'list'} onclick={() => setView('list')} title="List view" aria-label="List view">
        <span class="glyph-list"></span>
      </button>
      <button class="tool-btn" class:active={view === 'icons'} onclick={() => setView('icons')} title="Icon view" aria-label="Icon view">
        <span class="glyph-grid"></span>
      </button>
    </div>
    <span class="spacer"></span>
    <button class="tool-btn" onclick={() => pickFiles()} title="Import media (Ctrl+I)" aria-label="Import media">
      <Icon name="importIcon" size={14} />
    </button>
    <button class="tool-btn" onclick={() => pickFolder()} title="Import a folder" aria-label="Import a folder">
      <Icon name="folder" size={14} />
    </button>
    <Menu items={addMenu}>
      {#snippet trigger({ open, toggle })}
        <button class="tool-btn" class:active={open} onclick={toggle} title="New title, color matte, adjustment layer, sequence or bin" aria-label="New">
          <Icon name="plus" size={14} />
          <Icon name="chevronDown" size={10} />
        </button>
      {/snippet}
    </Menu>
  </div>

  {#if view === 'list' && media.length > 0}
    <div class="columns">
      <button class="col name" class:sorted={sortKey === 'name'} onclick={() => sortBy('name')}>
        Name{#if sortKey === 'name'}<span class="dir">{sortAsc ? '▲' : '▼'}</span>{/if}
      </button>
      <button class="col mono" class:sorted={sortKey === 'duration'} onclick={() => sortBy('duration')}>
        Duration{#if sortKey === 'duration'}<span class="dir">{sortAsc ? '▲' : '▼'}</span>{/if}
      </button>
      <span class="col size">Size</span>
      <span class="col codec">Codec</span>
      <button class="col status" class:sorted={sortKey === 'added'} onclick={() => sortBy('added')} title="Sort by the time it was added">
        Status{#if sortKey === 'added'}<span class="dir">{sortAsc ? '▲' : '▼'}</span>{/if}
      </button>
    </div>
  {:else if media.length > 0}
    <div class="columns icons-sort">
      <span class="col-label">Sort</span>
      <button class="col" class:sorted={sortKey === 'name'} onclick={() => sortBy('name')}>Name</button>
      <button class="col" class:sorted={sortKey === 'duration'} onclick={() => sortBy('duration')}>Duration</button>
      <button class="col" class:sorted={sortKey === 'added'} onclick={() => sortBy('added')}>Added</button>
    </div>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="list"
    class:drop-root={dropBin === 'root'}
    bind:this={list}
    role="listbox"
    aria-multiselectable="true"
    aria-label="Project items"
    tabindex="0"
    {onkeydown}
    onclick={(e) => {
      if (e.target === e.currentTarget) clearSelected();
    }}
    ondragover={(e) => binDragOver(e, 'root')}
    ondragleave={(e) => {
      if (e.target === e.currentTarget) dropBin = null;
    }}
    ondrop={(e) => binDrop(e, null)}>
    {#if media.length === 0 && sequences.length === 0}
      <div class="empty">
        <Icon name="importIcon" size={24} />
        <p>Drop media here or</p>
        <button class="empty-btn" onclick={() => pickFiles()}>Import files</button>
        <span class="hint">Video, audio and images. Nothing leaves this machine.</span>
      </div>
    {:else}
      {#if visibleSequences.length > 0}
        <div class="group-label">Sequences</div>
        {#each visibleSequences as seq (seq.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <div
            class="row sequence"
            class:selected={selected.has(seq.id)}
            class:active={seq.id === $activeSequence?.id}
            role="option"
            aria-selected={selected.has(seq.id)}
            tabindex="-1"
            onclick={(e) => pick(seq.id, e)}
            ondblclick={() => setActiveSequence(seq.id)}
            oncontextmenu={(e) => openMenu(e, sequenceMenu(seq))}>
            <span class="row-icon film"><Icon name="film" size={13} /></span>
            <span class="row-name" title={seq.name}>{seq.name}</span>
            <span class="row-sub">{seq.width}×{seq.height} {Number(seq.fps.toFixed(3))} fps</span>
          </div>
        {/each}
      {/if}

      {#each rootBins as bin (bin.id)}
        {@render binNode(bin, 0)}
      {/each}

      {#if bins.length > 0 || visibleSequences.length > 0}
        {#if inBin(null).length > 0}
          <div class="group-label">Media</div>
        {/if}
      {/if}
      {@render tiles(inBin(null), 0)}

      {#if media.length === 0 && bins.length === 0}
        <div class="empty small">
          <p>No media yet. Drop files here or use Import.</p>
        </div>
      {:else if needle && sorted.length === 0 && visibleSequences.length === 0}
        <div class="empty small">
          <p>Nothing matches "{query}"</p>
        </div>
      {/if}
    {/if}
  </div>

  {#if $importProgress}
    <div class="import-bar" title="Importing">
      <span class="import-name">{$importProgress.name}</span>
      <span class="import-count">{$importProgress.done}/{$importProgress.total}</span>
      <span class="import-track"><span class="import-fill" style="width: {importPercent}%"></span></span>
    </div>
  {/if}
</div>

{#snippet binNode(bin: Bin, depth: number)}
  {@const items = inBin(bin.id)}
  {@const children = childBins(bin.id)}
  {#if !needle || items.length > 0 || children.length > 0 || bin.name.toLowerCase().includes(needle)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="row bin"
      class:drop-target={dropBin === bin.id}
      style="padding-left: {10 + depth * 14}px"
      role="treeitem"
      aria-selected="false"
      aria-expanded={isOpen(bin.id)}
      tabindex="-1"
      onclick={(e) => {
        e.stopPropagation();
        toggleBin(bin.id);
      }}
      oncontextmenu={(e) => openMenu(e, binMenu(bin))}
      ondragover={(e) => {
        e.stopPropagation();
        binDragOver(e, bin.id);
      }}
      ondragleave={() => {
        if (dropBin === bin.id) dropBin = null;
      }}
      ondrop={(e) => binDrop(e, bin.id)}>
      <span class="chevron" class:open={isOpen(bin.id)}><Icon name="chevronRight" size={11} /></span>
      <span class="row-icon folder"><Icon name="folder" size={13} /></span>
      <span class="row-name" title={bin.name}>{bin.name}</span>
      <span class="row-sub">{items.length}</span>
    </div>
    {#if isOpen(bin.id)}
      {#each children as child (child.id)}
        {@render binNode(child, depth + 1)}
      {/each}
      {@render tiles(items, depth + 1)}
    {/if}
  {/if}
{/snippet}

{#snippet tiles(items: MediaItem[], depth: number)}
  {#if items.length > 0}
    <div class="tiles" class:grid={view === 'icons'} style="padding-left: {depth * 14}px">
      {#each items as item (item.id)}
        <MediaTile
          media={item}
          {view}
          size={$preferences.thumbnailSize}
          selected={selected.has(item.id)}
          progress={converting.get(item.id) ?? $proxyStatus.get(item.id) ?? null}
          onclick={(e) => pick(item.id, e)}
          ondblclick={() => openInSource(item)}
          oncontextmenu={(e) => {
            if (!selected.has(item.id)) {
              selected = new Set([item.id]);
              lastPicked = item.id;
            }
            openMenu(e, mediaMenu(item));
          }}
          ondragstart={(e) => onTileDragStart(item, e)}
          ondragend={onTileDragEnd}
          onstatus={() => onStatus(item)} />
      {/each}
    </div>
  {/if}
{/snippet}

<style>
  .project-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--bg-elevated);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 0 4px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1 1 80px;
    min-width: 60px;
    max-width: 220px;
    height: 22px;
    padding: 0 6px;
    color: var(--text-muted);
    background: var(--bg-deep);
    border: 1px solid var(--border);
  }

  .search:focus-within {
    border-color: var(--accent);
  }

  .search input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--text-primary);
    background: none;
    border: none;
    outline: none;
  }

  .search input::placeholder {
    color: var(--text-muted);
  }

  .search input::-webkit-search-cancel-button {
    appearance: none;
  }

  .view-toggle {
    display: flex;
    margin-left: 4px;
  }

  .spacer {
    flex: 1;
  }

  .tool-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1px;
    height: 22px;
    min-width: 22px;
    padding: 0 4px;
    color: var(--text-muted);
  }

  .tool-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tool-btn.active {
    background: var(--accent-dim);
    color: var(--accent);
  }

  .glyph-list,
  .glyph-grid {
    display: block;
    width: 12px;
    height: 12px;
  }

  .glyph-list {
    background: repeating-linear-gradient(to bottom, currentColor 0 2px, transparent 2px 5px);
  }

  .glyph-grid {
    background-image: linear-gradient(currentColor, currentColor), linear-gradient(currentColor, currentColor),
      linear-gradient(currentColor, currentColor), linear-gradient(currentColor, currentColor);
    background-size: 5px 5px;
    background-position: 0 0, 7px 0, 0 7px, 7px 7px;
    background-repeat: no-repeat;
  }

  .columns {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 22px;
    padding: 0 8px 0 10px;
    font-family: var(--font-editor);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
    overflow: hidden;
  }

  .col {
    display: flex;
    align-items: center;
    gap: 3px;
    color: var(--text-muted);
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    text-align: left;
    white-space: nowrap;
    flex-shrink: 0;
  }

  button.col:hover,
  .col.sorted {
    color: var(--text-secondary);
  }

  .dir {
    font-size: 7px;
  }

  /* column widths mirror the cells in the tile, the 32px thumb plus gap goes first */
  .columns:not(.icons-sort) .col.name {
    flex: 1 1 120px;
    min-width: 0;
    padding-left: 40px;
  }

  .col.mono {
    width: 64px;
  }

  .col.size {
    width: 110px;
  }

  .col.codec {
    width: 90px;
  }

  .col.status {
    width: 58px;
    justify-content: flex-end;
  }

  .icons-sort {
    gap: 10px;
  }

  .col-label {
    color: var(--text-muted);
    opacity: 0.7;
  }

  @media (max-width: 480px) {
    .col.codec,
    .col.size {
      display: none;
    }
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    outline: none;
    padding-bottom: 8px;
  }

  .list:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .list.drop-root {
    background: var(--accent-dim);
  }

  .group-label {
    padding: 8px 10px 4px;
    font-family: var(--font-editor);
    font-size: 9.5px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 8px 0 10px;
    font-size: 11.5px;
    color: var(--text-secondary);
    cursor: default;
    user-select: none;
    outline: none;
  }

  .row:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .row.selected {
    background: var(--accent-dim);
    color: var(--text-primary);
  }

  .row.sequence.active .row-name {
    color: var(--accent);
  }

  .row.bin.drop-target {
    background: var(--accent-dim);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .chevron {
    display: flex;
    color: var(--text-muted);
    transition: transform 100ms ease;
    flex-shrink: 0;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .row-icon {
    display: flex;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .row-icon.folder {
    color: var(--accent);
  }

  .row-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-sub {
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .tiles {
    display: flex;
    flex-direction: column;
  }

  .tiles.grid {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 2px;
    padding: 4px 6px;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    min-height: 140px;
    padding: 20px;
    color: var(--text-muted);
    text-align: center;
    font-size: 12px;
  }

  .empty.small {
    min-height: 60px;
    height: auto;
    font-size: 11.5px;
  }

  .empty-btn {
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-surface);
    border: 1px solid var(--border);
  }

  .empty-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .hint {
    font-family: var(--font-editor);
    font-size: 10px;
  }

  .import-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 20px;
    padding: 0 8px;
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    background: var(--bg-surface);
    flex-shrink: 0;
  }

  .import-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .import-track {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: var(--border);
  }

  .import-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 120ms linear;
  }
</style>
