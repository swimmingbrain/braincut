<script lang="ts">
  import { get } from 'svelte/store';
  import Dialog from '../Dialog.svelte';
  import Field from '../Field.svelte';
  import NumberField from '../NumberField.svelte';
  import ToggleField from '../ToggleField.svelte';
  import { activeSequence, editSequence, mediaById } from '$lib/project/store';
  import { findClipById, linkedClips, setClipSpeed } from '$lib/project/ops';
  import { formatTimecode, parseTimecode, snapToFrame } from '$lib/project/time';
  import { addToast } from '$lib/stores/app';

  let { clipIds, onclose }: { clipIds: string[]; onclose: () => void } = $props();

  const seq = get(activeSequence);
  const clips = clipIds.map((cid) => (seq ? findClipById(seq, cid)?.clip : undefined)).filter((c) => c !== undefined);
  const first = clips[0] ?? null;
  const fps = seq?.fps ?? 25;
  // the source range stays the same whatever the speed, so it anchors the two fields
  const span = first ? first.duration * first.speed : 0;
  const mixed = clips.some((c) => c.speed !== first?.speed);

  let speed = $state(first ? first.speed * 100 : 100);
  let reverse = $state(first?.reverse ?? false);
  let ripple = $state(false);
  let durationText = $state(first ? formatTimecode(snapToFrame(span / first.speed, fps), fps) : '');

  const durationFor = (percent: number) => Math.max(1 / fps, snapToFrame(span / (percent / 100), fps));

  function setSpeed(percent: number) {
    speed = percent;
    durationText = formatTimecode(durationFor(percent), fps);
  }

  function commitDuration(e: Event) {
    const parsed = parseTimecode((e.currentTarget as HTMLInputElement).value, fps);
    if (parsed === null || parsed <= 0 || span <= 0) {
      durationText = formatTimecode(durationFor(speed), fps);
      return;
    }
    const percent = Math.max(1, Math.min(10000, (span / parsed) * 100));
    speed = Number(percent.toFixed(2));
    durationText = formatTimecode(durationFor(speed), fps);
  }

  function ondurationkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
  }

  function apply() {
    if (clips.length === 0) return;
    const rate = speed / 100;
    if (!(rate > 0)) return;
    const getMedia = (mid: string) => get(mediaById).get(mid);
    let changed = 0;
    editSequence('speed / duration', (s) => {
      // a linked pair goes through setClipSpeed once, it handles both sides
      const done = new Set<string>();
      for (const cid of clipIds) {
        if (done.has(cid)) continue;
        for (const linked of linkedClips(s, cid)) done.add(linked.id);
        if (setClipSpeed(s, cid, rate, { reverse, rippleDurationChange: ripple, getMedia })) changed++;
      }
    });
    if (changed === 0) addToast('The selected clips are on locked tracks', 'warning');
    onclose();
  }
</script>

<Dialog title="Speed and duration" description="Change how fast the selected clips play." {onclose}>
  {#if first}
    <div class="form">
      <Field label="Speed">
        <NumberField value={speed} min={1} max={10000} step={1} precision={2} unit="%" label="Speed" onchange={setSpeed} />
      </Field>
      <Field label="Duration">
        <input class="text mono" bind:value={durationText} spellcheck="false" aria-label="Duration" onkeydown={ondurationkeydown} onblur={commitDuration} />
      </Field>
      <Field label="Reverse">
        <ToggleField value={reverse} label="Reverse" onchange={(v) => (reverse = v)} />
      </Field>
      <Field label="Ripple edit">
        <ToggleField value={ripple} label="Ripple edit, shifting trailing clips" onchange={(v) => (ripple = v)} />
      </Field>
    </div>
    <p class="help">
      {#if clips.length > 1}
        Applies to {clips.length} clips{mixed ? ', which currently play at different speeds' : ''}. The duration shown is the first one's.
      {:else}
        A speed above 100% shortens the clip, below lengthens it. Without ripple the clip stops where the next one begins.
      {/if}
    </p>
  {:else}
    <p class="help">Select a clip in the timeline first.</p>
  {/if}
  {#snippet footer()}
    <button class="dialog-btn" onclick={onclose}>Cancel</button>
    <button class="dialog-btn primary" onclick={apply} disabled={!first}>Apply</button>
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
    font-size: 12px;
    line-height: 16px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid transparent;
    border-bottom-color: var(--border);
    outline: none;
  }

  .text.mono {
    font-family: var(--font-editor);
    font-size: 11.5px;
    color: var(--accent);
    text-align: right;
  }

  .text:focus {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .help {
    margin-top: 10px;
    font-size: 11.5px;
    line-height: 1.5;
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
