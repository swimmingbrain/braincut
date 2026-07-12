<script lang="ts">
  import type { Keyframe } from '$lib/project/types';
  import { formatTimecode, snapToFrame } from '$lib/project/time';

  // one strip of the mini timeline on the right of the effect controls. it
  // spans the clip, shows the playhead and, for an animated param, its
  // keyframes as diamonds that can be dragged along the clip. the ruler
  // variant sits in the header row and draws the ticks
  let {
    duration,
    fps,
    time,
    keyframes = null,
    ruler = false,
    onseek,
    onmove,
    oncontext
  }: {
    duration: number;
    fps: number;
    // playhead, relative to the clip start
    time: number;
    keyframes?: Keyframe[] | null;
    ruler?: boolean;
    onseek?: (time: number) => void;
    // 'move' calls stack, each moves the keyframe from where the last one
    // left it. 'end' comes once, with time === newTime, to commit
    onmove?: (time: number, newTime: number, phase: 'move' | 'end') => void;
    oncontext?: (keyframe: Keyframe, x: number, y: number) => void;
  } = $props();

  let strip = $state<HTMLDivElement | null>(null);

  const TOL = 1e-4;
  const span = $derived(Math.max(duration, 1 / fps));

  function pct(t: number): number {
    return Math.min(100, Math.max(0, (t / span) * 100));
  }

  function timeAt(clientX: number): number {
    if (!strip) return 0;
    const rect = strip.getBoundingClientRect();
    const raw = ((clientX - rect.left) / Math.max(1, rect.width)) * span;
    return snapToFrame(Math.min(duration, Math.max(0, raw)), fps);
  }

  // ticks roughly every 60px, on a round number of seconds or frames
  const ticks = $derived.by(() => {
    const target = span / 6;
    const candidates = [1 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const stepSize = candidates.find((c) => c >= target) ?? candidates[candidates.length - 1];
    const out: number[] = [];
    for (let t = 0; t <= span + TOL; t += stepSize) out.push(t);
    return out;
  });

  function onstripdown(e: PointerEvent) {
    if (e.button !== 0 || !onseek) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    onseek(timeAt(e.clientX));
    let frame = 0;
    function move(ev: PointerEvent) {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onseek?.(timeAt(ev.clientX));
      });
    }
    function up(ev: PointerEvent) {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (frame) cancelAnimationFrame(frame);
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  // the listeners sit on the window: a preview re-sorts the keyframes and
  // svelte may rebuild the diamond under the pointer half way through
  function ondiamonddown(e: PointerEvent, kf: Keyframe) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const origin = kf.time;
    let current = origin;
    let pending = origin;
    let moved = false;
    let frame = 0;
    function move(ev: PointerEvent) {
      const next = timeAt(ev.clientX);
      if (Math.abs(next - pending) < TOL) return;
      moved = true;
      pending = next;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (Math.abs(pending - current) < TOL) return;
        onmove?.(current, pending, 'move');
        current = pending;
      });
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (frame) cancelAnimationFrame(frame);
      if (moved) {
        if (Math.abs(pending - current) >= TOL) onmove?.(current, pending, 'move');
        onmove?.(pending, pending, 'end');
      } else {
        // a click on a diamond parks the playhead on it
        onseek?.(origin);
      }
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lane" class:ruler bind:this={strip} onpointerdown={onstripdown}>
  {#if ruler}
    {#each ticks as t (t)}
      <div class="tick" style="left: {pct(t)}%">
        {#if t > 0 && pct(t) < 88}
          <span class="tick-label">{formatTimecode(t, fps, { showHours: false })}</span>
        {/if}
      </div>
    {/each}
  {/if}
  {#if keyframes}
    {#each keyframes as kf, i (i)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="diamond"
        class:current={Math.abs(kf.time - time) <= TOL}
        class:hold={kf.easing === 'hold'}
        style="left: {pct(kf.time)}%"
        title="{formatTimecode(kf.time, fps, { showHours: false })} · {kf.easing}"
        onpointerdown={(e) => ondiamonddown(e, kf)}
        oncontextmenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          oncontext?.(kf, e.clientX, e.clientY);
        }}></div>
    {/each}
  {/if}
  <div class="playhead" style="left: {pct(time)}%"></div>
</div>

<style>
  .lane {
    position: relative;
    height: 100%;
    min-height: 24px;
    background: var(--bg-deep);
    border-left: 1px solid var(--border);
    cursor: text;
    overflow: hidden;
    user-select: none;
  }

  .lane.ruler {
    background: var(--bg-surface);
  }

  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--border);
  }

  .tick-label {
    position: absolute;
    top: 2px;
    left: 3px;
    font-family: var(--font-editor);
    font-size: 9px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--playhead);
    pointer-events: none;
  }

  .diamond {
    position: absolute;
    top: 50%;
    width: 8px;
    height: 8px;
    margin: -4px 0 0 -4px;
    background: var(--text-secondary);
    transform: rotate(45deg);
    cursor: ew-resize;
    z-index: 1;
  }

  .diamond.hold {
    border-radius: 0 3px 0 0;
  }

  .diamond:hover,
  .diamond.current {
    background: var(--accent);
  }
</style>
