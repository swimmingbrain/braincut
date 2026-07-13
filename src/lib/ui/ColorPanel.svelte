<script lang="ts">
  import { onMount } from 'svelte';
  import { program, type Session } from '$lib/engine/session';
  import { createEffectInstance, paramDef } from '$lib/engine/effects/registry';
  import { isAnimated, setKeyframe, toggleAnimated, valueAt } from '$lib/project/keyframes';
  import { findClipById } from '$lib/project/ops';
  import { activeSequence, commitPreview, editSequence, preview } from '$lib/project/store';
  import type { Clip, EffectInstance, Project } from '$lib/project/types';
  import { playhead, selection } from '$lib/stores/app';
  import Icon from './Icon.svelte';
  import Scopes from './Scopes.svelte';
  import Slider from './Slider.svelte';

  let session = $state<Session | null>(null);
  let vignetteOpen = $state(false);

  onMount(() => {
    session = program();
  });

  const basic = ['temperature', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'vibrance'];
  const vignette = ['amount', 'midpoint', 'roundness', 'feather'];

  // the one visual clip that is selected, with the two effects if it has them
  const target = $derived.by(() => {
    const seq = $activeSequence;
    if (!seq) return null;
    const visual = $selection
      .map((id) => findClipById(seq, id)?.clip)
      .filter((c): c is Clip => !!c && c.kind !== 'audio');
    if (visual.length !== 1) return null;
    const clip = visual[0];
    return {
      clip,
      clipTime: Math.min(clip.duration, Math.max(0, $playhead - clip.start)),
      correction: clip.effects.find((e) => e.type === 'color-correction') ?? null,
      vignette: clip.effects.find((e) => e.type === 'vignette') ?? null
    };
  });

  function current(effect: EffectInstance | null, type: string, key: string, clipTime: number): number {
    const def = paramDef(type, key);
    const fallback = typeof def?.default === 'number' ? def.default : 0;
    if (!effect) return fallback;
    const v = valueAt(effect, key, clipTime, fallback);
    return typeof v === 'number' ? v : fallback;
  }

  // the effect is only added once a slider is touched, so a clip that was
  // never graded stays clean
  function ensure(draft: Project, clipId: string, type: string): { effect: EffectInstance; clipTime: number } | null {
    const seq = draft.sequences.find((s) => s.id === draft.activeSequenceId) ?? draft.sequences[0];
    const clip = seq && findClipById(seq, clipId)?.clip;
    if (!clip) return null;
    let effect = clip.effects.find((e) => e.type === type);
    if (!effect) {
      effect = createEffectInstance(type);
      clip.effects.push(effect);
    }
    return { effect, clipTime: Math.min(clip.duration, Math.max(0, $playhead - clip.start)) };
  }

  function setParam(type: string, key: string, value: number, live: boolean) {
    const t = target;
    if (!t) return;
    preview((draft) => {
      const found = ensure(draft, t.clip.id, type);
      if (!found) return;
      if (isAnimated(found.effect, key)) setKeyframe(found.effect, key, found.clipTime, value);
      else found.effect.params[key] = value;
    });
    if (!live) commitPreview(`${paramDef(type, key)?.label ?? key}`.toLowerCase());
  }

  function reset(type: string, key: string) {
    const def = paramDef(type, key);
    if (typeof def?.default === 'number') setParam(type, key, def.default, false);
  }

  function stopwatch(type: string, key: string) {
    const t = target;
    if (!t) return;
    editSequence(`animate ${paramDef(type, key)?.label ?? key}`.toLowerCase(), (_, draft) => {
      const found = ensure(draft, t.clip.id, type);
      if (found) toggleAnimated(found.effect, key, found.clipTime);
    });
  }
</script>

<div class="color-panel">
  {#if session}
    <Scopes source={session.canvas} />
  {/if}
  {#if !target}
    <div class="empty">Select a clip in the timeline to grade it</div>
  {:else}
    {@const t = target}
    <div class="sections">
      <div class="section">
        <div class="section-title">
          <span class="clip-name" title={t.clip.name}>{t.clip.name}</span>
          <span class="section-label">Basic Correction</span>
        </div>
        {#each basic as key (key)}
          {@const def = paramDef('color-correction', key)}
          {#if def}
            {@const animated = !!t.correction && isAnimated(t.correction, key)}
            <div class="row">
              <button
                class="stopwatch"
                class:on={animated}
                title={animated ? 'Stop animating' : 'Animate with keyframes'}
                aria-pressed={animated}
                onclick={() => stopwatch('color-correction', key)}>
                <Icon name={animated ? 'keyframeOn' : 'keyframe'} size={12} />
              </button>
              <button class="label" title="Double-click to reset" ondblclick={() => reset('color-correction', key)}>{def.label}</button>
              <div class="control">
                <Slider
                  value={current(t.correction, 'color-correction', key, t.clipTime)}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  precision={def.step && def.step < 1 ? 2 : 0}
                  unit={def.unit ?? ''}
                  label={def.label}
                  oninput={(v) => setParam('color-correction', key, v, true)}
                  onchange={(v) => setParam('color-correction', key, v, false)} />
              </div>
            </div>
          {/if}
        {/each}
      </div>

      <div class="section">
        <button class="section-title collapsible" aria-expanded={vignetteOpen} onclick={() => (vignetteOpen = !vignetteOpen)}>
          <Icon name={vignetteOpen ? 'chevronDown' : 'chevronRight'} size={12} />
          <span class="section-label">Vignette</span>
        </button>
        {#if vignetteOpen}
          {#each vignette as key (key)}
            {@const def = paramDef('vignette', key)}
            {#if def}
              {@const animated = !!t.vignette && isAnimated(t.vignette, key)}
              <div class="row">
                <button
                  class="stopwatch"
                  class:on={animated}
                  title={animated ? 'Stop animating' : 'Animate with keyframes'}
                  aria-pressed={animated}
                  onclick={() => stopwatch('vignette', key)}>
                  <Icon name={animated ? 'keyframeOn' : 'keyframe'} size={12} />
                </button>
                <button class="label" title="Double-click to reset" ondblclick={() => reset('vignette', key)}>{def.label}</button>
                <div class="control">
                  <Slider
                    value={current(t.vignette, 'vignette', key, t.clipTime)}
                    min={def.min}
                    max={def.max}
                    step={def.step}
                    precision={0}
                    unit={def.unit ?? ''}
                    label={def.label}
                    oninput={(v) => setParam('vignette', key, v, true)}
                    onchange={(v) => setParam('vignette', key, v, false)} />
                </div>
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .color-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-surface);
    container-type: inline-size;
  }

  .sections {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .section {
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 8px;
    width: 100%;
    text-align: left;
    color: var(--text-muted);
  }

  .section-title.collapsible:hover {
    color: var(--text-primary);
  }

  .section-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .clip-name {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 1px 8px 1px 4px;
    min-height: 24px;
  }

  .stopwatch {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .stopwatch:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .stopwatch.on {
    color: var(--accent);
  }

  .label {
    flex: 0 0 82px;
    font-size: 11.5px;
    color: var(--text-secondary);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: default;
  }

  .label:hover {
    color: var(--text-primary);
  }

  .control {
    flex: 1;
    min-width: 0;
    display: flex;
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
  }

  @container (max-width: 320px) {
    .label {
      flex-basis: 64px;
    }
  }
</style>
