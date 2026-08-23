<script lang="ts">
  import { get } from 'svelte/store';
  import Icon from './Icon.svelte';
  import Field from './Field.svelte';
  import NumberField from './NumberField.svelte';
  import SelectField from './SelectField.svelte';
  import ToggleField from './ToggleField.svelte';
  import ParamRow from './ParamRow.svelte';
  import KeyframeLane from './KeyframeLane.svelte';
  import { activeSequence, commitPreview, editSequence, mediaById, preview } from '$lib/project/store';
  import { contextMenu, dialog, playhead, selectedTransitionId, selection, type MenuItem } from '$lib/stores/app';
  import type { Clip, Easing, EffectInstance, Keyframe, ParamValue, Sequence, Transition } from '$lib/project/types';
  import { formatTimecode, snapToFrame } from '$lib/project/time';
  import { removeTransition, resizeTransition, setTransitionAlignment, type TransitionAlignment } from '$lib/project/ops';
  import {
    isAnimated,
    keyframeAt,
    moveKeyframe,
    removeKeyframe,
    setKeyframe,
    setKeyframeEasing,
    toggleAnimated,
    valueAt
  } from '$lib/project/keyframes';
  import { defaultParams, effectDef, type ParamDef } from '$lib/engine/effects/registry';
  import { transitionDef } from '$lib/engine/transitions/registry';
  import { fillScale, fitScale } from '$lib/engine/transform';
  import { sourceTimeAt } from '$lib/engine/clip-time';
  import { program } from '$lib/engine/session';

  // the effect controls of a desktop nle: the fixed effects of the selected
  // clip, then the ones added to it, each param with its stopwatch, and a
  // mini timeline on the right where the keyframes live. edits go through
  // the project store, the program monitor picks them up from there

  const TOL = 1e-4;
  const LANE_MIN_WIDTH = 420;

  let width = $state(0);
  let collapsed = $state<Set<string>>(new Set());
  let dropIndex = $state<{ clipId: string; index: number } | null>(null);
  let body = $state<HTMLDivElement | null>(null);

  const seq = $derived($activeSequence);
  const showLane = $derived(width >= LANE_MIN_WIDTH);

  interface Found {
    clip: Clip;
    trackKind: 'video' | 'audio';
  }

  const selected = $derived.by((): Found[] => {
    if (!seq) return [];
    const ids = new Set($selection);
    const out: Found[] = [];
    for (const track of seq.tracks) for (const clip of track.clips) if (ids.has(clip.id)) out.push({ clip, trackKind: track.kind });
    return out;
  });

  // the clip in focus and whatever is linked to it, picture first. anything
  // else in the selection is left alone, the panel edits one thing at a time
  const group = $derived.by((): Found[] => {
    const first = selected[0];
    if (!first) return [];
    const members = first.clip.linkId
      ? selected.filter((f) => f.clip.linkId === first.clip.linkId)
      : [first];
    return [...members].sort((a, b) => Number(a.trackKind === 'audio') - Number(b.trackKind === 'audio'));
  });
  const multiple = $derived(selected.length > group.length);

  const transition = $derived.by((): Transition | null => {
    const id = $selectedTransitionId;
    if (!seq || !id) return null;
    for (const track of seq.tracks) {
      const t = track.transitions.find((x) => x.id === id);
      if (t) return t;
    }
    return null;
  });
  const transitionInfo = $derived(transition ? transitionDef(transition.type) : undefined);

  function clipTime(clip: Clip): number {
    return Math.min(clip.duration, Math.max(0, $playhead - clip.start));
  }

  function clipTimeNow(clip: Clip): number {
    return Math.min(clip.duration, Math.max(0, get(playhead) - clip.start));
  }

  function seekClip(clip: Clip, t: number) {
    program().player.seek(clip.start + Math.min(clip.duration, Math.max(0, t)));
  }

  function sourceTimecode(clip: Clip): string | null {
    if (!clip.mediaId || !seq) return null;
    const media = $mediaById.get(clip.mediaId);
    if (!media || media.kind === 'image') return null;
    return formatTimecode(sourceTimeAt(clip, $playhead, media.duration), media.fps ?? seq.fps);
  }

  // every write finds the clip again inside the draft, the objects the panel
  // holds are frozen snapshots
  function withEffect(
    draft: Sequence,
    clipId: string,
    effectId: string,
    fn: (effect: EffectInstance, clip: Clip) => void
  ) {
    for (const track of draft.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (!clip) continue;
      const effect = clip.effects.find((e) => e.id === effectId);
      if (effect) fn(effect, clip);
      return;
    }
  }

  function withClip(draft: Sequence, clipId: string, fn: (clip: Clip) => void) {
    for (const track of draft.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) {
        fn(clip);
        return;
      }
    }
  }

  function activeSeq(draft: { sequences: Sequence[]; activeSequenceId: string | null }): Sequence | undefined {
    return draft.sequences.find((s) => s.id === draft.activeSequenceId) ?? draft.sequences[0];
  }

  function setParam(clip: Clip, effect: EffectInstance, def: ParamDef, value: ParamValue, live: boolean) {
    const time = clipTimeNow(clip);
    preview((draft) => {
      const s = activeSeq(draft);
      if (!s) return;
      withEffect(s, clip.id, effect.id, (e) => {
        if (isAnimated(e, def.key)) setKeyframe(e, def.key, time, value);
        else e.params[def.key] = value;
      });
    });
    if (!live) commitPreview(`change ${def.label.toLowerCase()}`);
  }

  function onToggleAnimated(clip: Clip, effect: EffectInstance, key: string) {
    const time = clipTimeNow(clip);
    editSequence('toggle animation', (s) => withEffect(s, clip.id, effect.id, (e) => toggleAnimated(e, key, time)));
  }

  function onToggleKeyframe(clip: Clip, effect: EffectInstance, key: string) {
    const time = clipTimeNow(clip);
    const exists = !!keyframeAt(effect, key, time);
    editSequence(exists ? 'remove keyframe' : 'add keyframe', (s) =>
      withEffect(s, clip.id, effect.id, (e) => {
        if (exists) removeKeyframe(e, key, time);
        else setKeyframe(e, key, time, valueAt(e, key, time));
      })
    );
  }

  function prevKeyframe(effect: EffectInstance, key: string, time: number): Keyframe | null {
    const list = effect.keyframes[key] ?? [];
    const before = list.filter((k) => k.time < time - TOL);
    return before.length ? before[before.length - 1] : null;
  }

  function nextKeyframe(effect: EffectInstance, key: string, time: number): Keyframe | null {
    return (effect.keyframes[key] ?? []).find((k) => k.time > time + TOL) ?? null;
  }

  function onMoveKeyframe(clip: Clip, effect: EffectInstance, key: string, from: number, to: number, phase: 'move' | 'end') {
    if (phase === 'end') {
      commitPreview('move keyframe');
      return;
    }
    preview((draft) => {
      const s = activeSeq(draft);
      if (s) withEffect(s, clip.id, effect.id, (e) => moveKeyframe(e, key, from, to));
    });
  }

  const easings: { value: Easing; label: string }[] = [
    { value: 'linear', label: 'Linear' },
    { value: 'hold', label: 'Hold' },
    { value: 'ease-in', label: 'Ease in' },
    { value: 'ease-out', label: 'Ease out' },
    { value: 'ease-in-out', label: 'Ease in and out' }
  ];

  function keyframeMenu(clip: Clip, effect: EffectInstance, key: string, kf: Keyframe, x: number, y: number) {
    const items: MenuItem[] = easings.map((e) => ({
      label: e.label,
      checked: kf.easing === e.value,
      action: () =>
        editSequence('change easing', (s) => withEffect(s, clip.id, effect.id, (ef) => setKeyframeEasing(ef, key, kf.time, e.value)))
    }));
    items.push({ label: '', separator: true });
    items.push({
      label: 'Delete keyframe',
      danger: true,
      action: () => editSequence('remove keyframe', (s) => withEffect(s, clip.id, effect.id, (ef) => removeKeyframe(ef, key, kf.time)))
    });
    contextMenu.set({ x, y, items });
  }

  function setEnabled(clip: Clip, effect: EffectInstance, enabled: boolean) {
    editSequence(enabled ? 'enable effect' : 'disable effect', (s) => withEffect(s, clip.id, effect.id, (e) => (e.enabled = enabled)));
  }

  function resetEffect(clip: Clip, effect: EffectInstance) {
    editSequence('reset effect', (s) =>
      withEffect(s, clip.id, effect.id, (e) => {
        e.params = defaultParams(e.type);
        e.keyframes = {};
      })
    );
  }

  function removeEffect(clip: Clip, effect: EffectInstance) {
    editSequence('remove effect', (s) => withClip(s, clip.id, (c) => (c.effects = c.effects.filter((e) => e.id !== effect.id))));
  }

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
  }

  // reordering: the handle is dragged up or down the list, the added effects
  // of the same clip make room, and the order is written once on release.
  // fixed effects never move
  function startReorder(e: PointerEvent, clip: Clip, effect: EffectInstance) {
    if (e.button !== 0 || !body) return;
    e.preventDefault();
    const firstMovable = clip.effects.findIndex((x) => !x.fixed);
    const from = clip.effects.indexOf(effect);
    const headers = Array.from(body.querySelectorAll<HTMLElement>(`[data-effect-clip="${clip.id}"]`)).filter(
      (el) => Number(el.dataset.effectIndex) >= firstMovable
    );
    let target = from;
    let frame = 0;
    let lastY = e.clientY;

    // where the effect would land if the pointer were let go here
    function indexAt(y: number): number {
      for (const el of headers) {
        const rect = el.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) return Number(el.dataset.effectIndex);
      }
      return clip.effects.length;
    }
    function move(ev: PointerEvent) {
      lastY = ev.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        dropIndex = { clipId: clip.id, index: indexAt(lastY) };
      });
    }
    function up(ev: PointerEvent) {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (frame) cancelAnimationFrame(frame);
      dropIndex = null;
      // a quick drag can end before the next frame, so the drop is worked
      // out from the pointer itself and not from what the last frame drew
      target = indexAt(ev.clientY);
      if (target === from || target === from + 1) return;
      editSequence('reorder effects', (s) =>
        withClip(s, clip.id, (c) => {
          const [moved] = c.effects.splice(from, 1);
          c.effects.splice(target > from ? target - 1 : target, 0, moved);
        })
      );
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function mediaSize(clip: Clip): { width: number; height: number } | null {
    if (!seq) return null;
    if (clip.mediaId) {
      const media = $mediaById.get(clip.mediaId);
      return media && media.width > 0 ? { width: media.width, height: media.height } : null;
    }
    // titles, mattes and adjustment layers are drawn at frame size already
    return { width: seq.width, height: seq.height };
  }

  function applyScale(clip: Clip, effect: EffectInstance, mode: 'fit' | 'fill') {
    const size = mediaSize(clip);
    if (!size || !seq) return;
    const scale = Math.round((mode === 'fit' ? fitScale(size, seq) : fillScale(size, seq)) * 100) / 100;
    const time = clipTimeNow(clip);
    editSequence(mode === 'fit' ? 'set to frame size' : 'scale to fill', (s) =>
      withEffect(s, clip.id, effect.id, (e) => {
        for (const key of ['scale', 'scaleY']) {
          if (isAnimated(e, key)) setKeyframe(e, key, time, scale);
          else e.params[key] = scale;
        }
        e.params.position = [0, 0];
      })
    );
  }

  function visibleParams(effect: EffectInstance, defs: ParamDef[]): ParamDef[] {
    if (effect.type !== 'transform') return defs;
    const uniform = effect.params.uniformScale !== false;
    return defs.filter((d) => !(uniform && d.key === 'scaleY'));
  }

  function speedLabel(clip: Clip): string {
    const pct = Math.round(clip.speed * 1000) / 10;
    return `${pct}%${clip.reverse ? ', reversed' : ''}`;
  }

  // transitions

  function setTransitionDuration(t: Transition, seconds: number) {
    if (!seq) return;
    const d = Math.max(1 / seq.fps, snapToFrame(seconds, seq.fps));
    // grow and shrink around the middle so the cut stays where it is
    const start = snapToFrame(t.start - (d - t.duration) / 2, seq.fps);
    editSequence('resize transition', (s) => resizeTransition(s, t.id, start, d));
  }

  function setTransitionParam(t: Transition, def: ParamDef, value: ParamValue, live: boolean) {
    preview((draft) => {
      const s = activeSeq(draft);
      if (!s) return;
      for (const track of s.tracks) {
        const found = track.transitions.find((x) => x.id === t.id);
        if (found) {
          found.params[def.key] = value;
          return;
        }
      }
    });
    if (!live) commitPreview(`change ${def.label.toLowerCase()}`);
  }

  function transitionAlignment(t: Transition): TransitionAlignment {
    if (!seq) return 'center';
    const left = t.leftClipId ? findClip(seq, t.leftClipId) : null;
    const cut = left ? left.start + left.duration : t.start;
    if (Math.abs(t.start - cut) <= TOL) return 'start';
    if (Math.abs(t.start + t.duration - cut) <= TOL) return 'end';
    return 'center';
  }

  function findClip(s: Sequence, id: string): Clip | null {
    for (const track of s.tracks) {
      const c = track.clips.find((x) => x.id === id);
      if (c) return c;
    }
    return null;
  }

  const alignmentOptions = [
    { value: 'start', label: 'Start at cut' },
    { value: 'center', label: 'Center at cut' },
    { value: 'end', label: 'End at cut' }
  ];
</script>

<div class="effect-controls" bind:clientWidth={width}>
  {#if seq && transition}
    <div class="head">
      <div class="head-left">
        <span class="name">{transitionInfo?.name ?? transition.type}</span>
        <span class="tc">{formatTimecode(transition.start, seq.fps)}</span>
      </div>
    </div>
    <div class="body" bind:this={body}>
      <Field label="Duration">
        {#snippet before()}
          <span class="fold-gap"></span>
        {/snippet}
        <NumberField
          value={transition.duration}
          min={1 / seq.fps}
          max={600}
          step={1 / seq.fps}
          precision={3}
          unit=" s"
          onchange={(v) => transition && setTransitionDuration(transition, v)} />
      </Field>
      <Field label="Alignment">
        {#snippet before()}
          <span class="fold-gap"></span>
        {/snippet}
        <SelectField
          value={transitionAlignment(transition)}
          options={alignmentOptions}
          disabled={!transition.leftClipId || !transition.rightClipId}
          onchange={(v) => transition && editSequence('align transition', (s) => setTransitionAlignment(s, transition.id, v as TransitionAlignment))} />
      </Field>
      {#each transitionInfo?.params ?? [] as def (def.key)}
        <ParamRow
          {def}
          value={transition.params[def.key] ?? def.default}
          keyframable={false}
          onchange={(v) => transition && setTransitionParam(transition, def, v, false)}
          oninput={(v) => transition && setTransitionParam(transition, def, v, true)} />
      {/each}
      <div class="actions">
        <button
          class="action-btn"
          onclick={() => {
            if (!transition) return;
            const id = transition.id;
            editSequence('remove transition', (s) => removeTransition(s, id));
            selectedTransitionId.set(null);
          }}>
          <Icon name="trash" size={12} />
          <span>Remove</span>
        </button>
      </div>
    </div>
  {:else if seq && group.length > 0}
    <div class="body" bind:this={body}>
      {#each group as { clip } (clip.id)}
        {@const time = clipTime(clip)}
        {@const source = sourceTimecode(clip)}
        <div class="row head sticky">
          <div class="cell params head-left">
            <span class="name" title={clip.name}>{clip.name}</span>
            <span class="tc">
              {#if source}<span title="Source">{source}</span><span class="sep">/</span>{/if}
              <span title="Timeline">{formatTimecode($playhead, seq.fps)}</span>
            </span>
          </div>
          {#if showLane}
            <div class="cell lane">
              <KeyframeLane duration={clip.duration} fps={seq.fps} {time} ruler onseek={(t) => seekClip(clip, t)} />
            </div>
          {/if}
        </div>

        {#each clip.effects as effect, index (effect.id)}
          {@const def = effectDef(effect.type)}
          {@const open = !collapsed.has(effect.id)}
          <div
            class="row group"
            class:drop-before={dropIndex?.clipId === clip.id && dropIndex.index === index}
            data-effect-clip={clip.id}
            data-effect-index={index}>
            <div class="cell params group-head" class:disabled={!effect.enabled}>
              <button class="fold" onclick={() => toggleCollapsed(effect.id)} aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open}>
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
              </button>
              <button
                class="fx"
                class:on={effect.enabled}
                title={effect.enabled ? 'Disable effect' : 'Enable effect'}
                aria-pressed={effect.enabled}
                onclick={() => setEnabled(clip, effect, !effect.enabled)}>
                <Icon name="fx" size={12} />
              </button>
              <span class="group-name">{def?.name ?? effect.type}</span>
              <span class="spacer"></span>
              <button class="tool" title="Reset" onclick={() => resetEffect(clip, effect)}>
                <Icon name="undo" size={12} />
              </button>
              {#if !effect.fixed}
                <button class="tool" title="Remove effect" onclick={() => removeEffect(clip, effect)}>
                  <Icon name="close" size={12} />
                </button>
                <span
                  class="tool handle"
                  title="Drag to reorder"
                  role="button"
                  tabindex="-1"
                  onpointerdown={(e) => startReorder(e, clip, effect)}>
                  <Icon name="more" size={12} />
                </span>
              {/if}
            </div>
            {#if showLane}
              <div class="cell lane">
                <KeyframeLane duration={clip.duration} fps={seq.fps} {time} onseek={(t) => seekClip(clip, t)} />
              </div>
            {/if}
          </div>

          {#if open && def}
            {#each visibleParams(effect, def.params) as pdef (pdef.key)}
              {@const animated = isAnimated(effect, pdef.key)}
              <div class="row" class:disabled={!effect.enabled}>
                <div class="cell params">
                  <ParamRow
                    def={pdef}
                    value={valueAt(effect, pdef.key, time, pdef.default)}
                    {animated}
                    onKeyframe={animated && !!keyframeAt(effect, pdef.key, time)}
                    hasPrev={animated && !!prevKeyframe(effect, pdef.key, time)}
                    hasNext={animated && !!nextKeyframe(effect, pdef.key, time)}
                    onchange={(v) => setParam(clip, effect, pdef, v, false)}
                    oninput={(v) => setParam(clip, effect, pdef, v, true)}
                    ontoggleanimated={() => onToggleAnimated(clip, effect, pdef.key)}
                    ontogglekeyframe={() => onToggleKeyframe(clip, effect, pdef.key)}
                    onprev={() => {
                      const k = prevKeyframe(effect, pdef.key, time);
                      if (k) seekClip(clip, k.time);
                    }}
                    onnext={() => {
                      const k = nextKeyframe(effect, pdef.key, time);
                      if (k) seekClip(clip, k.time);
                    }} />
                </div>
                {#if showLane}
                  <div class="cell lane">
                    <KeyframeLane
                      duration={clip.duration}
                      fps={seq.fps}
                      {time}
                      keyframes={animated ? effect.keyframes[pdef.key] : null}
                      onseek={(t) => seekClip(clip, t)}
                      onmove={(from, to, phase) => onMoveKeyframe(clip, effect, pdef.key, from, to, phase)}
                      oncontext={(kf, x, y) => keyframeMenu(clip, effect, pdef.key, kf, x, y)} />
                  </div>
                {/if}
              </div>
            {/each}
            {#if effect.type === 'transform'}
              <div class="row">
                <div class="cell params actions">
                  <button class="action-btn" onclick={() => applyScale(clip, effect, 'fit')}>Set to frame size</button>
                  <button class="action-btn" onclick={() => applyScale(clip, effect, 'fill')}>Scale to fill</button>
                </div>
                {#if showLane}
                  <div class="cell lane">
                    <KeyframeLane duration={clip.duration} fps={seq.fps} {time} onseek={(t) => seekClip(clip, t)} />
                  </div>
                {/if}
              </div>
            {/if}
          {/if}

          {#if (effect.type === 'opacity' || effect.type === 'pan') && clip.mediaId && clip.kind !== 'image'}
            <div class="row group">
              <div class="cell params group-head">
                <span class="fold-gap"></span>
                <span class="group-name">Time</span>
              </div>
              {#if showLane}
                <div class="cell lane">
                  <KeyframeLane duration={clip.duration} fps={seq.fps} {time} onseek={(t) => seekClip(clip, t)} />
                </div>
              {/if}
            </div>
            <div class="row">
              <div class="cell params">
                <Field label="Speed">
                  <span class="readout">{speedLabel(clip)}</span>
                  <button class="action-btn" onclick={() => dialog.set({ kind: 'speed', clipIds: [clip.id] })}>Edit…</button>
                </Field>
              </div>
              {#if showLane}
                <div class="cell lane">
                  <KeyframeLane duration={clip.duration} fps={seq.fps} {time} onseek={(t) => seekClip(clip, t)} />
                </div>
              {/if}
            </div>
          {/if}
        {/each}
        <div class="row group" class:drop-before={dropIndex?.clipId === clip.id && dropIndex.index === clip.effects.length}></div>
      {/each}
    </div>
    {#if multiple}
      <div class="foot">{selected.length} clips selected, showing the first</div>
    {/if}
  {:else}
    <div class="empty">
      <Icon name="fx" size={18} />
      <span>{seq && selected.length > 1 ? `${selected.length} clips selected` : 'Select a clip to edit its effects'}</span>
    </div>
  {/if}
</div>

<style>
  .effect-controls {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--bg-surface);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .row {
    display: flex;
    align-items: stretch;
    min-height: 24px;
  }

  .row.disabled .params {
    opacity: 0.5;
  }

  .cell.params {
    flex: 1 1 60%;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .cell.params > :global(.field) {
    flex: 1;
    min-width: 0;
  }

  .cell.lane {
    flex: 0 0 40%;
    min-width: 0;
  }

  .head {
    height: 32px;
    min-height: 32px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
  }

  .head.sticky {
    position: sticky;
    top: 0;
    z-index: 2;
  }

  .head-left {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    min-width: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tc {
    display: flex;
    gap: 4px;
    font-family: var(--font-editor);
    font-size: 10.5px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .sep {
    color: var(--border);
  }

  .row.group {
    border-top: 1px solid var(--border);
  }

  .row.group.drop-before {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  .group-head {
    height: 26px;
    gap: 2px;
    padding: 0 6px 0 4px;
    background: var(--bg-elevated);
  }

  .group-head.disabled .group-name {
    color: var(--text-muted);
  }

  .group-name {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .spacer {
    flex: 1;
  }

  .fold,
  .fold-gap,
  .fx,
  .tool {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .fold:hover,
  .tool:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .fx.on {
    color: var(--accent);
  }

  .fx:hover {
    background: var(--bg-hover);
  }

  .handle {
    cursor: grab;
  }

  .actions {
    display: flex;
    gap: 4px;
    padding: 4px 8px 4px 26px;
    flex-wrap: wrap;
  }

  .readout {
    flex: 1;
    font-family: var(--font-editor);
    font-size: 11.5px;
    color: var(--text-secondary);
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .foot {
    padding: 4px 8px;
    font-size: 10.5px;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 11.5px;
    color: var(--text-muted);
    padding: 16px;
    text-align: center;
  }
</style>
