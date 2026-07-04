<script lang="ts">
  import Dialog from '../Dialog.svelte';
  import Field from '../Field.svelte';
  import NumberField from '../NumberField.svelte';
  import SelectField from '../SelectField.svelte';
  import Icon from '../Icon.svelte';
  import { activeSequence, editSequence } from '$lib/project/store';
  import { snapToFrame } from '$lib/project/time';
  import { fpsOptions } from '$lib/templates/sequences';

  let { onclose }: { onclose: () => void } = $props();

  const seq = $activeSequence;
  let name = $state(seq?.name ?? '');
  let width = $state(seq?.width ?? 1920);
  let height = $state(seq?.height ?? 1080);
  let fps = $state(seq?.fps ?? 25);

  const fpsChoices = fpsOptions.map((f) => ({ value: String(f), label: String(f) }));
  const rateChanged = $derived(seq !== null && fps !== seq.fps);

  function apply() {
    if (!seq) return;
    const nextFps = fps;
    editSequence('sequence settings', (s) => {
      s.name = name.trim() || s.name;
      s.width = Math.round(width);
      s.height = Math.round(height);
      if (s.fps !== nextFps) {
        s.fps = nextFps;
        // every position has to sit on the new frame grid or the cuts drift
        for (const track of s.tracks) {
          for (const clip of track.clips) {
            clip.start = snapToFrame(clip.start, nextFps);
            clip.duration = Math.max(1 / nextFps, snapToFrame(clip.duration, nextFps));
          }
          for (const t of track.transitions) {
            t.start = snapToFrame(t.start, nextFps);
            t.duration = Math.max(1 / nextFps, snapToFrame(t.duration, nextFps));
          }
        }
        for (const m of s.markers) m.time = snapToFrame(m.time, nextFps);
      }
    });
    onclose();
  }
</script>

<Dialog title="Sequence settings" description="Change the size and rate of the open sequence." {onclose}>
  {#if seq}
    <div class="form">
      <Field label="Name">
        <input class="text" bind:value={name} spellcheck="false" aria-label="Sequence name" />
      </Field>
      <Field label="Frame size">
        <div class="pair">
          <NumberField value={width} min={16} max={16384} step={2} precision={0} unit=" px" label="Width" onchange={(v) => (width = v)} />
          <span class="x">×</span>
          <NumberField value={height} min={16} max={16384} step={2} precision={0} unit=" px" label="Height" onchange={(v) => (height = v)} />
        </div>
      </Field>
      <Field label="Frame rate">
        <SelectField value={String(fps)} options={fpsChoices} onchange={(v) => (fps = Number(v))} label="Frame rate" />
      </Field>
      <Field label="Audio">
        <span class="static">{seq.sampleRate / 1000} kHz stereo</span>
      </Field>
    </div>
    <p class="warn">
      <Icon name="info" size={12} />
      <span>Clips keep their position and scale. Footage is not rescaled to a new frame size{rateChanged ? ', and cuts snap to the new frame grid' : ''}.</span>
    </p>
  {:else}
    <p class="warn">There is no sequence open.</p>
  {/if}
  {#snippet footer()}
    <button class="dialog-btn" onclick={onclose}>Cancel</button>
    <button class="dialog-btn primary" onclick={apply} disabled={!seq}>Apply</button>
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

  .static {
    font-family: var(--font-editor);
    font-size: 11.5px;
    color: var(--text-muted);
  }

  .warn {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-top: 12px;
    padding: 8px 10px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    background: var(--bg-deep);
    border-left: 2px solid var(--warning);
  }

  .dialog-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .dialog-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dialog-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .dialog-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #111;
  }

  .dialog-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }
</style>
