<script lang="ts">
  import Dialog from '../Dialog.svelte';
  import Field from '../Field.svelte';
  import NumberField from '../NumberField.svelte';
  import SelectField from '../SelectField.svelte';
  import { createProject, createSequence } from '$lib/project/defaults';
  import { loadProject } from '$lib/project/store';
  import { setLastOpenedId, touchRecent } from '$lib/project/persistence';
  import { fpsOptions, presetById, presets } from '$lib/templates/sequences';
  import { addToast } from '$lib/stores/app';

  let { onclose }: { onclose: () => void } = $props();

  let name = $state('Untitled project');
  let presetId = $state(presets[1].id);
  let width = $state(presets[1].width);
  let height = $state(presets[1].height);
  let fps = $state(presets[1].fps);

  const presetOptions = [...presets.map((p) => ({ value: p.id, label: p.name })), { value: 'custom', label: 'Custom' }];
  const fpsChoices = fpsOptions.map((f) => ({ value: String(f), label: String(f) }));
  const description = $derived(presetById(presetId)?.description ?? 'Any size and rate you need');

  function pickPreset(id: string) {
    presetId = id;
    const preset = presetById(id);
    if (!preset) return;
    width = preset.width;
    height = preset.height;
    fps = preset.fps;
  }

  // editing a size by hand turns the preset into 'custom' so the select tells the truth
  function custom() {
    presetId = 'custom';
  }

  function create() {
    const trimmed = name.trim() || 'Untitled project';
    const p = createProject(trimmed);
    const seq = createSequence({ name: 'Sequence 1', width: Math.round(width), height: Math.round(height), fps });
    p.sequences.push(seq);
    p.activeSequenceId = seq.id;
    loadProject(p);
    touchRecent(p).catch(() => {});
    setLastOpenedId(p.id).catch(() => {});
    addToast(`${trimmed} created`, 'success');
    onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      create();
    }
  }
</script>

<Dialog title="New project" description="Name the project and pick the sequence it starts with." {onclose}>
  <div class="form">
    <Field label="Name">
      <input class="text" bind:value={name} spellcheck="false" aria-label="Project name" {onkeydown} />
    </Field>
    <Field label="Preset" hint={description}>
      <SelectField value={presetId} options={presetOptions} onchange={pickPreset} label="Sequence preset" />
    </Field>
    <p class="note">{description}</p>
    <Field label="Frame size">
      <div class="pair">
        <NumberField value={width} min={16} max={16384} step={2} precision={0} unit=" px" label="Width" onchange={(v) => { width = v; custom(); }} />
        <span class="x">×</span>
        <NumberField value={height} min={16} max={16384} step={2} precision={0} unit=" px" label="Height" onchange={(v) => { height = v; custom(); }} />
      </div>
    </Field>
    <Field label="Frame rate">
      <SelectField value={String(fps)} options={fpsChoices} onchange={(v) => { fps = Number(v); custom(); }} label="Frame rate" />
    </Field>
  </div>
  {#snippet footer()}
    <button class="dialog-btn" onclick={onclose}>Cancel</button>
    <button class="dialog-btn primary" onclick={create}>Create</button>
  {/snippet}
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0 -8px;
  }

  .text {
    width: 100%;
    padding: 3px 6px;
    font-family: var(--font-ui);
    font-size: 12px;
    line-height: 16px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid transparent;
    border-bottom-color: var(--border);
    outline: none;
  }

  .text:focus {
    border-color: var(--accent);
  }

  .pair {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }

  .x {
    color: var(--text-muted);
    font-size: 11px;
  }

  .note {
    padding: 0 8px 4px 124px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .dialog-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .dialog-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dialog-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #111;
  }

  .dialog-btn.primary:hover {
    background: var(--accent-hover);
  }
</style>
