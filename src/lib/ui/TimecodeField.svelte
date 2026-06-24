<script lang="ts">
  import { formatTime, parseTimecode, type TimeFormat } from '$lib/project/time';

  // a timecode that turns into an input on focus. typing accepts everything
  // parseTimecode does: full timecodes, packed digits, '+12' / '-12' frames
  let {
    value,
    fps,
    format = 'timecode',
    onchange,
    base,
    disabled = false,
    label = 'Timecode'
  }: {
    value: number;
    fps: number;
    format?: TimeFormat;
    onchange: (seconds: number) => void;
    // what relative entries count from, defaults to the value itself
    base?: number;
    disabled?: boolean;
    label?: string;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  let input = $state<HTMLInputElement | null>(null);

  const display = $derived(formatTime(value, fps, format));

  function startEdit() {
    if (disabled) return;
    draft = format === 'seconds' ? value.toFixed(2) : display;
    editing = true;
    queueMicrotask(() => {
      input?.focus();
      input?.select();
    });
  }

  function commit() {
    if (!editing) return;
    editing = false;
    const text = draft.trim();
    let parsed: number | null = null;
    if (format === 'seconds' && /^[+-]?\d*\.?\d+s?$/.test(text)) {
      // seconds view: plain numbers mean seconds, signed ones are relative
      const n = parseFloat(text);
      parsed = /^[+-]/.test(text) ? (base ?? value) + n : n;
    } else {
      parsed = parseTimecode(text, fps, base ?? value);
    }
    if (parsed !== null && Number.isFinite(parsed)) onchange(Math.max(0, parsed));
  }

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing = false;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const frames = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      editing = false;
      onchange(Math.max(0, value + frames / fps));
    }
  }

  function onbuttonkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const frames = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
      onchange(Math.max(0, value + frames / fps));
    }
  }
</script>

{#if editing}
  <input
    bind:this={input}
    class="timecode input"
    type="text"
    spellcheck="false"
    aria-label={label}
    bind:value={draft}
    onblur={commit}
    onkeydown={onkeydown} />
{:else}
  <button
    class="timecode"
    type="button"
    {disabled}
    title="{label}: click to type a timecode, +/- frames"
    aria-label={label}
    onclick={startEdit}
    onkeydown={onbuttonkeydown}>{display}</button>
{/if}

<style>
  .timecode {
    font-family: var(--font-editor);
    font-size: 11px;
    line-height: 16px;
    padding: 1px 4px;
    color: var(--text-secondary);
    background: none;
    border: 1px solid transparent;
    white-space: nowrap;
    text-align: left;
    min-width: 0;
  }

  button.timecode:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  button.timecode:focus-visible {
    outline: none;
    border-color: var(--accent);
  }

  .input {
    width: 8.5em;
    color: var(--text-primary);
    background: var(--bg-deep);
    border-color: var(--accent);
    outline: none;
  }
</style>
