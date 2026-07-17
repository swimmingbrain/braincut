<script lang="ts">
  // a stereo level meter in db. the bars follow the engine, the peak line
  // holds for a moment and the clip light stays on until clicked, like on a
  // desk, so a short overshoot is not missed
  let {
    levels,
    min = -60,
    max = 6,
    height
  }: {
    // db per channel
    levels: [number, number];
    min?: number;
    max?: number;
    height?: number;
  } = $props();

  const HOLD_MS = 1200;

  let peaks = $state<[number, number]>([-Infinity, -Infinity]);
  let clipped = $state(false);
  let peakAt: [number, number] = [0, 0];

  $effect(() => {
    const [l, r] = levels;
    const now = performance.now();
    const next: [number, number] = [peaks[0], peaks[1]];
    for (const [i, v] of [l, r].entries()) {
      if (v >= next[i] || now - peakAt[i] > HOLD_MS) {
        next[i] = v;
        peakAt[i] = now;
      }
    }
    if (next[0] !== peaks[0] || next[1] !== peaks[1]) peaks = next;
    if (l >= 0 || r >= 0) clipped = true;
  });

  const pct = (db: number) => `${Math.min(100, Math.max(0, ((db - min) / (max - min)) * 100))}%`;
  const scale = [0, -6, -12, -24, -48];
</script>

<div class="meter" style:height={height ? `${height}px` : undefined}>
  <button class="clip" class:on={clipped} title={clipped ? 'Clipped, click to reset' : 'Clip indicator'} aria-label="Clip indicator" onclick={() => (clipped = false)}></button>
  <div class="bars">
    {#each levels as level, i (i)}
      <div class="bar">
        <div class="cover" style:height="calc(100% - {pct(level)})"></div>
        <div class="peak" style:bottom={pct(peaks[i])}></div>
      </div>
    {/each}
    <div class="scale" aria-hidden="true">
      {#each scale as db (db)}
        <span style:bottom={pct(db)}>{db}</span>
      {/each}
    </div>
  </div>
</div>

<style>
  .meter {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    flex: 1;
    min-height: 60px;
  }

  .clip {
    height: 5px;
    background: var(--bg-deep);
    border: 1px solid var(--border);
    cursor: pointer;
    flex-shrink: 0;
  }

  .clip.on {
    background: var(--error);
    border-color: var(--error);
  }

  .bars {
    position: relative;
    flex: 1;
    display: flex;
    gap: 2px;
    min-height: 0;
    padding-right: 16px;
  }

  .bar {
    position: relative;
    flex: 1;
    /* green up to -12, amber to -3, red beyond, the usual meter ramp */
    background: linear-gradient(to top, var(--success) 0%, var(--success) 72%, var(--warning) 86%, var(--error) 100%);
    overflow: hidden;
  }

  /* the unlit part is painted over from the top, so the ramp never moves */
  .cover {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    background: var(--bg-deep);
    will-change: height;
  }

  .peak {
    position: absolute;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--text-primary);
    will-change: bottom;
  }

  .scale {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: 14px;
    pointer-events: none;
  }

  .scale span {
    position: absolute;
    right: 0;
    transform: translateY(50%);
    font-family: var(--font-editor);
    font-size: 8px;
    line-height: 1;
    color: var(--text-muted);
  }
</style>
