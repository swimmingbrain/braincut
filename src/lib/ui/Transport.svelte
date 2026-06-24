<script lang="ts">
  import type { Player } from '$lib/engine/session';
  import { snapToFrame } from '$lib/project/time';
  import { loopPlayback } from '$lib/stores/app';
  import { preferences } from '$lib/stores/preferences';
  import Icon from './Icon.svelte';
  import TimecodeField from './TimecodeField.svelte';

  let {
    player,
    fps,
    duration,
    inPoint,
    outPoint,
    onmarkin,
    onmarkout,
    onaddmarker,
    compact = false
  }: {
    player: Player;
    fps: number;
    duration: number;
    inPoint: number | null;
    outPoint: number | null;
    onmarkin: () => void;
    onmarkout: () => void;
    onaddmarker?: () => void;
    compact?: boolean;
  } = $props();

  const time = $derived(player.time);
  const playing = $derived(player.playing);

  // the bar covers the whole sequence, at least one frame so an empty
  // sequence still has somewhere to put the marker
  const span = $derived(Math.max(duration, 1 / fps));
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / span) * 100))}%`;

  let bar = $state<HTMLDivElement | null>(null);

  function seekAt(clientX: number) {
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    player.seek(snapToFrame(frac * span, fps));
  }

  function onbarpointerdown(e: PointerEvent) {
    if (e.button !== 0 || !bar) return;
    const el = bar;
    el.setPointerCapture(e.pointerId);
    player.pause();
    seekAt(e.clientX);
    let frame = 0;
    function move(ev: PointerEvent) {
      // one seek per animation frame, pointermove fires much faster than that
      cancelAnimationFrame(frame);
      const x = ev.clientX;
      frame = requestAnimationFrame(() => seekAt(x));
    }
    function up(ev: PointerEvent) {
      cancelAnimationFrame(frame);
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      seekAt(ev.clientX);
    }
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  }

  function toggleLoop() {
    const next = !$loopPlayback;
    loopPlayback.set(next);
    player.setLoop(next);
  }

  function goToIn() {
    player.seek(inPoint ?? 0);
  }

  function goToOut() {
    player.seek(outPoint ?? duration);
  }
</script>

<div class="transport" class:compact>
  <div
    class="bar"
    bind:this={bar}
    role="slider"
    tabindex="-1"
    aria-label="Scrub"
    aria-valuemin={0}
    aria-valuemax={span}
    aria-valuenow={$time}
    onpointerdown={onbarpointerdown}>
    {#if inPoint !== null || outPoint !== null}
      <div class="range" style:left={pct(inPoint ?? 0)} style:right="calc(100% - {pct(outPoint ?? span)})"></div>
    {/if}
    {#if inPoint !== null}<div class="point" style:left={pct(inPoint)}></div>{/if}
    {#if outPoint !== null}<div class="point" style:left={pct(outPoint)}></div>{/if}
    <div class="head" style:left={pct($time)}></div>
  </div>

  <div class="row">
    <TimecodeField value={$time} {fps} format={$preferences.timecodeFormat} onchange={(t) => player.seek(t)} label="Current time" />

    <div class="buttons">
      <button class="tbtn" title="Mark in (I)" aria-label="Mark in" onclick={onmarkin}><Icon name="markIn" size={14} /></button>
      <button class="tbtn" title="Go to in (Shift+I)" aria-label="Go to in" onclick={goToIn}><Icon name="toStart" size={14} /></button>
      <button class="tbtn" title="Step back (Left)" aria-label="Step back one frame" onclick={() => player.step(-1)}><Icon name="stepBack" size={14} /></button>
      <button class="tbtn play" title={$playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={$playing ? 'Pause' : 'Play'} onclick={() => player.toggle()}>
        <Icon name={$playing ? 'pause' : 'play'} size={16} />
      </button>
      <button class="tbtn" title="Step forward (Right)" aria-label="Step forward one frame" onclick={() => player.step(1)}><Icon name="stepForward" size={14} /></button>
      <button class="tbtn" title="Go to out (Shift+O)" aria-label="Go to out" onclick={goToOut}><Icon name="toEnd" size={14} /></button>
      <button class="tbtn" title="Mark out (O)" aria-label="Mark out" onclick={onmarkout}><Icon name="markOut" size={14} /></button>
      {#if onaddmarker}
        <button class="tbtn extra" title="Add marker (M)" aria-label="Add marker" onclick={onaddmarker}><Icon name="marker" size={14} /></button>
      {/if}
      <button class="tbtn extra" class:active={$loopPlayback} title="Loop playback" aria-label="Loop playback" aria-pressed={$loopPlayback} onclick={toggleLoop}>
        <Icon name="loop" size={14} />
      </button>
    </div>

    <TimecodeField value={duration} {fps} format={$preferences.timecodeFormat} onchange={() => {}} disabled label="Duration" />
  </div>
</div>

<style>
  .transport {
    flex-shrink: 0;
    container-type: inline-size;
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
  }

  .bar {
    position: relative;
    height: 10px;
    background: var(--bg-deep);
    cursor: pointer;
    overflow: hidden;
    outline: none;
  }

  .range {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--accent-dim);
  }

  .point {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent);
    opacity: 0.6;
  }

  .head {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--playhead);
    /* the marker moves every frame, keep it off the layout */
    will-change: left;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    height: 30px;
    padding: 0 4px;
  }

  .buttons {
    display: flex;
    align-items: center;
    gap: 1px;
    min-width: 0;
  }

  .tbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .tbtn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .tbtn:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  .tbtn.play {
    width: 28px;
    color: var(--text-primary);
  }

  .tbtn.active {
    color: var(--accent);
    background: var(--accent-dim);
  }

  /* the extras go first when the panel gets narrow, the core buttons stay */
  .compact .extra {
    display: none;
  }

  @container (max-width: 340px) {
    .extra {
      display: none;
    }
  }
</style>
