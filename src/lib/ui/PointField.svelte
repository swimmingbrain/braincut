<script lang="ts">
  import NumberField from './NumberField.svelte';

  let {
    value,
    onchange,
    oninput,
    step = 1,
    precision = 1,
    unit = '',
    min,
    max,
    disabled = false,
    label
  }: {
    value: [number, number];
    onchange: (value: [number, number]) => void;
    oninput?: (value: [number, number]) => void;
    step?: number;
    precision?: number;
    unit?: string;
    min?: number;
    max?: number;
    disabled?: boolean;
    label?: string;
  } = $props();
</script>

<div class="point">
  <NumberField
    value={value[0]}
    {step}
    {precision}
    {unit}
    {min}
    {max}
    {disabled}
    label={label ? label + ' x' : 'x'}
    onchange={(x) => onchange([x, value[1]])}
    oninput={oninput ? (x) => oninput([x, value[1]]) : undefined} />
  <NumberField
    value={value[1]}
    {step}
    {precision}
    {unit}
    {min}
    {max}
    {disabled}
    label={label ? label + ' y' : 'y'}
    onchange={(y) => onchange([value[0], y])}
    oninput={oninput ? (y) => oninput([value[0], y]) : undefined} />
</div>

<style>
  .point {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    width: 100%;
  }
</style>
