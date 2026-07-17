<script lang="ts">
  import NumberField from './NumberField.svelte';

  // a vertical db fader. the travel is linear in db, which is what a mixer
  // fader feels like at the top end where it matters. 0 db has a detent so
  // unity is easy to hit again after a nudge
  let {
    value,
    onchange,
    oninput,
    min = -60,
    max = 12,
    disabled = false,
    label = 'Level'
  }: {
    value: number;
    onchange: (db: number) => void;
    oninput?: (db: number) => void;
    min?: number;
    max?: number;
    disabled?: boolean;
    label?: string;
  } = $props();

  const DETENT_DB = 0.75;

  let track = $state<HTMLDivElement | null>(null);

  const pct = (db: number) => ((db - min) / (max - min)) * 100;

  function dbAt(clientY: number, fine: boolean, start: number, startY: number): number {
    if (!track) return value;
    const rect = track.getBoundingClientRect();
    let db: number;
    if (fine) {
      // shift: a tenth of the travel per pixel, from where the drag began
      db = start - ((clientY - startY) / rect.height) * (max - min) * 0.1;
    } else {
      db = max - ((clientY - rect.top) / rect.height) * (max - min);
    }
    db = Math.min(max, Math.max(min, db));
    if (Math.abs(db) < DETENT_DB) db = 0;
    return Math.round(db * 10) / 10;
  }

  function onpointerdown(e: PointerEvent) {
    if (disabled || e.button !== 0 || !track) return;
    e.preventDefault();
    const el = track;
    el.setPointerCapture(e.pointerId);
    const start = value;
    const startY = e.clientY;
    let frame = 0;
    const emit = oninput ?? onchange;
    emit(dbAt(e.clientY, e.shiftKey, start, startY));

    function move(ev: PointerEvent) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => emit(dbAt(ev.clientY, ev.shiftKey, start, startY)));
    }
    function up(ev: PointerEvent) {
      cancelAnimationFrame(frame);
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onchange(dbAt(ev.clientY, ev.shiftKey, start, startY));
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function onkeydown(e: KeyboardEvent) {
    if (disabled) return;
    const step = e.shiftKey ? 3 : 0.5;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      onchange(Math.min(max, value + step));
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onchange(Math.max(min, value - step));
    } else if (e.key === 'Home' || e.key === '0') {
      e.preventDefault();
      onchange(0);
    }
  }
</script>

<div class="fader" class:disabled>
  <div
    class="track"
    bind:this={track}
    role="slider"
    tabindex={disabled ? -1 : 0}
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext="{value.toFixed(1)} dB"
    title="Double-click to reset to 0 dB"
    onpointerdown={onpointerdown}
    ondblclick={() => !disabled && onchange(0)}
    onkeydown={onkeydown}>
    <div class="unity" style:bottom="{pct(0)}%"></div>
    <div class="knob" style:bottom="{pct(value)}%"></div>
  </div>
  <div class="value">
    <NumberField {value} {min} {max} step={0.1} precision={1} unit="dB" {disabled} {label} {onchange} {oninput} />
  </div>
</div>

<style>
  .fader {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-height: 0;
  }

  .track {
    position: relative;
    flex: 1;
    width: 22px;
    min-height: 60px;
    cursor: ns-resize;
    outline: none;
  }

  .track::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 3px;
    margin-left: -1.5px;
    background: var(--bg-deep);
    border: 1px solid var(--border);
  }

  .track:focus-visible::before {
    border-color: var(--accent);
  }

  .unity {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 1px;
    background: var(--text-muted);
    opacity: 0.6;
  }

  .knob {
    position: absolute;
    left: 0;
    right: 0;
    height: 14px;
    margin-bottom: -7px;
    background: var(--bg-hover);
    border: 1px solid var(--text-muted);
    will-change: bottom;
  }

  .knob::after {
    content: '';
    position: absolute;
    left: 3px;
    right: 3px;
    top: 50%;
    height: 1px;
    background: var(--accent);
  }

  .track:hover .knob {
    border-color: var(--text-secondary);
  }

  .value {
    width: 56px;
    flex-shrink: 0;
  }

  .fader.disabled {
    opacity: 0.4;
  }
</style>
