<script lang="ts">
  import { browser } from '$app/environment';
  import Icon from './Icon.svelte';
  import type { Clip, Id, Track } from '$lib/project/types';
  import { activeSequence, editSequence, selectedClips } from '$lib/project/store';
  import { addTransition, clipEnd, trackOf } from '$lib/project/ops';
  import { nearlyEqual } from '$lib/project/time';
  import { addToast, contextMenu, type MenuItem } from '$lib/stores/app';
  import { preferences } from '$lib/stores/preferences';
  import { audioEffectGroups, createEffectInstance, effectsInGroup, videoEffectGroups, type EffectDef } from '$lib/engine/effects/registry';
  import { transitionGroups, transitionsInGroup, type TransitionDef } from '$lib/engine/transitions/registry';
  import { endDrag, startDrag } from '$lib/editor/drag';

  interface Row {
    id: string;
    name: string;
    kind: 'effect' | 'transition';
    media: 'video' | 'audio';
    description?: string;
  }

  interface Group {
    key: string;
    name: string;
    icon: string;
    rows: Row[];
  }

  interface Section {
    key: string;
    name: string;
    groups: Group[];
  }

  const COLLAPSED_KEY = 'braincut-effects-collapsed';

  function effectRow(d: EffectDef, media: 'video' | 'audio'): Row {
    return { id: d.type, name: d.name, kind: 'effect', media, description: d.description };
  }

  function transitionRow(d: TransitionDef): Row {
    return { id: d.id, name: d.name, kind: 'transition', media: d.kind, description: d.description };
  }

  const groupIcons: Record<string, string> = {
    'Blur & Sharpen': 'zoom',
    'Color Correction': 'palette',
    Keying: 'eye',
    Stylize: 'fx',
    Distort: 'wave',
    Transform: 'fit',
    Generate: 'image',
    Amplitude: 'audio',
    'Filter & EQ': 'mixer',
    Dynamics: 'wave',
    'Reverb & Delay': 'loop',
    Stereo: 'audio',
    Dissolve: 'film',
    Wipe: 'slide',
    'Slide & Push': 'slip',
    '3D & Motion': 'ripple',
    Zoom: 'zoom',
    Audio: 'audio'
  };

  const sections: Section[] = [
    {
      key: 'video-effects',
      name: 'Video Effects',
      groups: videoEffectGroups.map((g) => ({ key: `ve:${g}`, name: g, icon: groupIcons[g] ?? 'fx', rows: effectsInGroup(g).map((d) => effectRow(d, 'video')) }))
    },
    {
      key: 'audio-effects',
      name: 'Audio Effects',
      groups: audioEffectGroups.map((g) => ({ key: `ae:${g}`, name: g, icon: groupIcons[g] ?? 'audio', rows: effectsInGroup(g).map((d) => effectRow(d, 'audio')) }))
    },
    {
      key: 'video-transitions',
      name: 'Video Transitions',
      groups: transitionGroups
        .filter((g) => g !== 'Audio')
        .map((g) => ({ key: `vt:${g}`, name: g, icon: groupIcons[g] ?? 'film', rows: transitionsInGroup(g).map(transitionRow) }))
    },
    {
      key: 'audio-transitions',
      name: 'Audio Transitions',
      groups: [{ key: 'at:Audio', name: 'Crossfade', icon: 'audio', rows: transitionsInGroup('Audio').map(transitionRow) }]
    }
  ].map((s) => ({ ...s, groups: s.groups.filter((g) => g.rows.length > 0) }));

  function storedCollapsed(): Set<string> {
    // sections start open, groups start closed, like the panel in a desktop nle
    const initial = new Set(sections.flatMap((s) => s.groups.map((g) => g.key)));
    if (!browser) return initial;
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {}
    return initial;
  }

  let query = $state('');
  let collapsed = $state<Set<string>>(storedCollapsed());
  const needle = $derived(query.trim().toLowerCase());

  function isOpen(key: string): boolean {
    return needle !== '' || !collapsed.has(key);
  }

  function toggle(key: string) {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsed = next;
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {}
  }

  function matches(row: Row): boolean {
    return !needle || row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle);
  }

  const filtered = $derived(
    sections
      .map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, rows: g.rows.filter(matches) })).filter((g) => g.rows.length > 0) }))
      .filter((s) => s.groups.length > 0)
  );

  function isDefault(row: Row): boolean {
    if (row.kind !== 'transition') return false;
    return row.media === 'video' ? $preferences.defaultVideoTransition === row.id : $preferences.defaultAudioTransition === row.id;
  }

  function setDefault(row: Row) {
    preferences.update((p) =>
      row.media === 'video' ? { ...p, defaultVideoTransition: row.id } : { ...p, defaultAudioTransition: row.id }
    );
    addToast(`${row.name} is the default ${row.media} transition`, 'success');
  }

  function fits(row: Row, clip: Clip): boolean {
    return row.media === 'audio' ? clip.kind === 'audio' : clip.kind !== 'audio';
  }

  function applyEffect(row: Row) {
    const clips = selectedClips().filter((c) => fits(row, c));
    if (clips.length === 0) {
      addToast(`Select a ${row.media} clip to apply ${row.name}`, 'info');
      return;
    }
    const ids = new Set(clips.map((c) => c.id));
    editSequence(`add ${row.name.toLowerCase()}`, (seq) => {
      for (const track of seq.tracks) for (const clip of track.clips) {
        if (ids.has(clip.id)) clip.effects.push(createEffectInstance(row.id));
      }
    });
  }

  function neighbours(track: Track, clip: Clip): { prev: Clip | null; next: Clip | null } {
    const i = track.clips.findIndex((c) => c.id === clip.id);
    const prev = track.clips[i - 1] ?? null;
    const next = track.clips[i + 1] ?? null;
    return {
      prev: prev && nearlyEqual(clipEnd(prev), clip.start) ? prev : null,
      next: next && nearlyEqual(clipEnd(clip), next.start) ? next : null
    };
  }

  // one transition per selected clip: on the cut before it when there is
  // one, otherwise at its tail
  function applyTransition(row: Row) {
    const seq = $activeSequence;
    if (!seq) return;
    const clips = selectedClips().filter((c) => fits(row, c));
    if (clips.length === 0) {
      addToast(`Select a ${row.media} clip to add ${row.name}`, 'info');
      return;
    }
    const duration = $preferences.defaultTransitionDuration;
    let added = 0;
    editSequence(`add ${row.name.toLowerCase()}`, (draft) => {
      const done = new Set<Id>();
      for (const picked of clips) {
        const track = trackOf(draft, picked.id);
        const clip = track?.clips.find((c) => c.id === picked.id);
        if (!track || !clip) continue;
        const { prev, next } = neighbours(track, clip);
        const left = prev ? prev.id : clip.id;
        const right = prev ? clip.id : next ? next.id : null;
        const key = `${left}:${right}`;
        if (done.has(key)) continue;
        done.add(key);
        if (addTransition(draft, track.id, { type: row.id, leftClipId: left, rightClipId: right, duration })) added++;
      }
    });
    if (added === 0) addToast('No cut to put the transition on', 'warning');
  }

  function apply(row: Row) {
    if (row.kind === 'effect') applyEffect(row);
    else applyTransition(row);
  }

  function rowMenu(row: Row): MenuItem[] {
    const items: MenuItem[] = [{ label: 'Apply to selected clips', action: () => apply(row) }];
    if (row.kind === 'transition') {
      items.push({ label: 'Set as default transition', checked: isDefault(row), action: () => setDefault(row) });
    }
    return items;
  }

  function oncontextmenu(e: MouseEvent, row: Row) {
    e.preventDefault();
    contextMenu.set({ x: e.clientX, y: e.clientY, items: rowMenu(row) });
  }

  function ondragstart(e: DragEvent, row: Row) {
    startDrag(row.kind === 'effect' ? { kind: 'effect', type: row.id } : { kind: 'transition', type: row.id }, e);
  }

  function onrowkeydown(e: KeyboardEvent, row: Row) {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply(row);
    }
  }
</script>

<div class="effects-panel">
  <div class="toolbar">
    <label class="search">
      <Icon name="search" size={12} />
      <input type="search" placeholder="Search effects" bind:value={query} spellcheck="false" aria-label="Search effects" onkeydown={(e) => e.stopPropagation()} />
    </label>
  </div>

  <div class="tree" role="tree" aria-label="Effects">
    {#each filtered as section (section.key)}
      <button class="node section" aria-expanded={isOpen(section.key)} onclick={() => toggle(section.key)}>
        <span class="chevron" class:open={isOpen(section.key)}><Icon name="chevronRight" size={11} /></span>
        <span class="node-name">{section.name}</span>
      </button>
      {#if isOpen(section.key)}
        {#each section.groups as group (group.key)}
          <button class="node group" aria-expanded={isOpen(group.key)} onclick={() => toggle(group.key)}>
            <span class="chevron" class:open={isOpen(group.key)}><Icon name="chevronRight" size={11} /></span>
            <span class="node-icon"><Icon name={group.icon} size={12} /></span>
            <span class="node-name">{group.name}</span>
            <span class="count">{group.rows.length}</span>
          </button>
          {#if isOpen(group.key)}
            {#each group.rows as row (row.kind + row.id)}
              <div
                class="node row"
                class:default={isDefault(row)}
                role="treeitem"
                aria-selected="false"
                tabindex="0"
                title={row.description ? `${row.name}: ${row.description}` : `Double-click to apply ${row.name} to the selected clips, or drag it onto a clip`}
                draggable="true"
                ondragstart={(e) => ondragstart(e, row)}
                ondragend={endDrag}
                ondblclick={() => apply(row)}
                oncontextmenu={(e) => oncontextmenu(e, row)}
                onkeydown={(e) => onrowkeydown(e, row)}>
                <span class="node-icon dim"><Icon name={row.kind === 'transition' ? group.icon : 'fx'} size={12} /></span>
                <span class="node-name">{row.name}</span>
                {#if isDefault(row)}
                  <span class="star" title="Default transition">*</span>
                {/if}
              </div>
            {/each}
          {/if}
        {/each}
      {/if}
    {/each}
    {#if filtered.length === 0}
      <div class="empty">Nothing matches "{query}"</div>
    {/if}
  </div>
</div>

<style>
  .effects-panel {
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
    height: 32px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 5px;
    flex: 1;
    min-width: 0;
    max-width: 260px;
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

  .tree {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 2px 0 8px;
  }

  .node {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    height: 24px;
    padding: 0 8px;
    font-size: 11.5px;
    color: var(--text-secondary);
    text-align: left;
    user-select: none;
    outline: none;
  }

  .node:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .node.section {
    font-size: 10px;
    font-weight: 500;
    font-family: var(--font-editor);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    padding-left: 6px;
  }

  .node.group {
    padding-left: 18px;
  }

  .node.row {
    padding-left: 44px;
    cursor: grab;
  }

  .node.row:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .node.row.default .node-name {
    color: var(--text-primary);
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

  .node-icon {
    display: flex;
    flex-shrink: 0;
    color: var(--accent);
  }

  .node-icon.dim {
    color: var(--text-muted);
  }

  .node-name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .count {
    font-family: var(--font-editor);
    font-size: 10px;
    color: var(--text-muted);
  }

  .star {
    font-family: var(--font-editor);
    font-size: 13px;
    line-height: 1;
    color: var(--accent);
  }

  .empty {
    padding: 20px;
    text-align: center;
    font-size: 11.5px;
    color: var(--text-muted);
  }
</style>
