<script lang="ts">
  import type { ParamDef } from '$lib/engine/effects/registry';
  import type { ParamValue } from '$lib/project/types';
  import Field from './Field.svelte';
  import Icon from './Icon.svelte';
  import NumberField from './NumberField.svelte';
  import Slider from './Slider.svelte';
  import ToggleField from './ToggleField.svelte';
  import ColorField from './ColorField.svelte';
  import SelectField from './SelectField.svelte';
  import PointField from './PointField.svelte';

  // one parameter of an effect: stopwatch, label, the control its kind asks
  // for and, once animated, the keyframe navigator. the row itself knows
  // nothing about clips or time, the panel hands it the value at the playhead
  let {
    def,
    value,
    animated = false,
    onKeyframe = false,
    hasPrev = false,
    hasNext = false,
    keyframable = true,
    disabled = false,
    onchange,
    oninput,
    ontoggleanimated,
    ontogglekeyframe,
    onprev,
    onnext
  }: {
    def: ParamDef;
    value: ParamValue;
    animated?: boolean;
    // the playhead sits on a keyframe of this param
    onKeyframe?: boolean;
    hasPrev?: boolean;
    hasNext?: boolean;
    keyframable?: boolean;
    disabled?: boolean;
    onchange: (value: ParamValue) => void;
    oninput?: (value: ParamValue) => void;
    ontoggleanimated?: () => void;
    ontogglekeyframe?: () => void;
    onprev?: () => void;
    onnext?: () => void;
  } = $props();

  const canAnimate = $derived(keyframable && def.animatable);

  // a bounded range that is not absurdly wide reads better as a slider
  const useSlider = $derived(
    def.kind === 'number' && def.min !== undefined && def.max !== undefined && def.max - def.min <= 1000
  );

  function precisionFor(step: number | undefined): number {
    if (!step || step >= 1) return 0;
    return Math.min(4, Math.ceil(-Math.log10(step)));
  }

  const num = $derived(typeof value === 'number' ? value : Number(def.default) || 0);
  const bool = $derived(typeof value === 'boolean' ? value : Boolean(def.default));
  const text = $derived(typeof value === 'string' ? value : String(def.default));
  const point = $derived<[number, number]>(Array.isArray(value) ? value : [0, 0]);
</script>

<Field label={def.label}>
  {#snippet before()}
    {#if canAnimate}
      <button
        class="stopwatch"
        class:on={animated}
        title={animated ? 'Stop animating' : 'Toggle animation'}
        aria-pressed={animated}
        {disabled}
        onclick={ontoggleanimated}>
        <Icon name={animated ? 'keyframeOn' : 'keyframe'} size={12} />
      </button>
    {:else}
      <span class="stopwatch-gap"></span>
    {/if}
  {/snippet}

  {#if def.kind === 'boolean'}
    <ToggleField value={bool} {disabled} label={def.label} onchange={(v) => onchange(v)} />
  {:else if def.kind === 'color'}
    <ColorField value={text} {disabled} label={def.label} onchange={(v) => onchange(v)} oninput={oninput ? (v) => oninput(v) : undefined} />
  {:else if def.kind === 'select'}
    <SelectField value={text} options={def.options ?? []} {disabled} label={def.label} onchange={(v) => onchange(v)} />
  {:else if def.kind === 'point'}
    <PointField
      value={point}
      step={def.step ?? 1}
      unit={def.unit ?? ''}
      precision={precisionFor(def.step)}
      {disabled}
      label={def.label}
      onchange={(v) => onchange(v)}
      oninput={oninput ? (v) => oninput(v) : undefined} />
  {:else if useSlider}
    <Slider
      value={num}
      min={def.min}
      max={def.max}
      step={def.step ?? 1}
      unit={def.unit ?? ''}
      precision={precisionFor(def.step)}
      {disabled}
      label={def.label}
      onchange={(v) => onchange(v)}
      oninput={oninput ? (v) => oninput(v) : undefined} />
  {:else}
    <NumberField
      value={num}
      min={def.min}
      max={def.max}
      step={def.step ?? 1}
      unit={def.unit ?? (def.kind === 'angle' ? '°' : '')}
      precision={precisionFor(def.step)}
      {disabled}
      label={def.label}
      onchange={(v) => onchange(v)}
      oninput={oninput ? (v) => oninput(v) : undefined} />
  {/if}

  {#snippet after()}
    {#if animated}
      <button class="nav" title="Previous keyframe" disabled={!hasPrev || disabled} onclick={onprev}>
        <Icon name="chevronRight" size={11} />
      </button>
      <button
        class="nav key"
        class:on={onKeyframe}
        title={onKeyframe ? 'Remove keyframe' : 'Add keyframe'}
        {disabled}
        onclick={ontogglekeyframe}>
        <Icon name={onKeyframe ? 'keyframeOn' : 'keyframe'} size={11} />
      </button>
      <button class="nav" title="Next keyframe" disabled={!hasNext || disabled} onclick={onnext}>
        <Icon name="chevronRight" size={11} />
      </button>
    {/if}
  {/snippet}
</Field>

<style>
  .stopwatch,
  .stopwatch-gap {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .stopwatch:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .stopwatch.on {
    color: var(--accent);
  }

  .stopwatch:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .nav {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  /* the left arrow is the right one turned around, one glyph fewer to keep */
  .nav:first-child {
    transform: rotate(180deg);
  }

  .nav:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .nav.key.on {
    color: var(--accent);
  }
</style>
