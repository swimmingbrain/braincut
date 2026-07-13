<script lang="ts">
  // an rgb histogram and a luma waveform read off the program canvas. the
  // picture is copied into a small offscreen canvas a few times a second,
  // which is cheap enough to leave on while grading
  let {
    source,
    interval = 250
  }: {
    source: HTMLCanvasElement;
    interval?: number;
  } = $props();

  const W = 256;
  const H = 144;

  let histogram = $state<HTMLCanvasElement | null>(null);
  let waveform = $state<HTMLCanvasElement | null>(null);

  const channelColors = ['rgba(224, 108, 117, 0.7)', 'rgba(115, 201, 145, 0.7)', 'rgba(97, 175, 239, 0.7)'];

  function drawHistogram(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray) {
    const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < data.length; i += 4) {
      bins[0][data[i]]++;
      bins[1][data[i + 1]]++;
      bins[2][data[i + 2]]++;
    }
    let peak = 1;
    for (const b of bins) for (let i = 1; i < 255; i++) peak = Math.max(peak, b[i]);
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const [c, b] of bins.entries()) {
      ctx.fillStyle = channelColors[c];
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < 256; i++) {
        // log scale keeps the shadows readable next to a bright peak
        const v = Math.log1p(b[i]) / Math.log1p(peak);
        ctx.lineTo((i / 255) * w, h - v * h);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawWaveform(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const image = ctx.createImageData(w, h);
    const out = image.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const luma = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) | 0;
        const px = ((x / W) * w) | 0;
        const py = h - 1 - ((luma / 255) * (h - 1)) | 0;
        const o = (py * w + px) * 4;
        // each hit brightens the dot, so dense areas glow in the accent
        out[o] = 209;
        out[o + 1] = 154;
        out[o + 2] = 102;
        out[o + 3] = Math.min(255, out[o + 3] + 40);
      }
    }
    ctx.putImageData(image, 0, 0);
    // the reference lines at 0, 50 and 100 ire
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    for (const f of [0, 0.5, 1]) {
      const y = Math.round(h - 1 - f * (h - 1)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  $effect(() => {
    const hist = histogram;
    const wave = waveform;
    if (!hist || !wave) return;
    const sample = document.createElement('canvas');
    sample.width = W;
    sample.height = H;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    const hctx = hist.getContext('2d');
    const wctx = wave.getContext('2d');
    if (!sctx || !hctx || !wctx) return;
    let last: ImageData | null = null;

    function tick() {
      if (document.hidden || source.width === 0) return;
      try {
        sctx!.drawImage(source, 0, 0, W, H);
        last = sctx!.getImageData(0, 0, W, H);
      } catch {
        // a webgl canvas with preserveDrawingBuffer off can read back black
        // between frames, nothing to do but try again next time
        return;
      }
      drawHistogram(hctx!, last.data);
      drawWaveform(wctx!, last.data);
    }

    tick();
    const timer = setInterval(tick, interval);
    return () => clearInterval(timer);
  });
</script>

<div class="scopes">
  <div class="scope">
    <canvas bind:this={histogram} width="256" height="72" aria-label="RGB histogram"></canvas>
    <span class="label">Histogram</span>
  </div>
  <div class="scope">
    <canvas bind:this={waveform} width="256" height="72" aria-label="Luma waveform"></canvas>
    <span class="label">Waveform</span>
  </div>
</div>

<style>
  .scopes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }

  .scope {
    position: relative;
    background: var(--bg-deep);
    border: 1px solid var(--border);
    aspect-ratio: 256 / 72;
    min-width: 0;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .label {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    pointer-events: none;
  }

  @container (max-width: 320px) {
    .scopes {
      grid-template-columns: 1fr;
    }
  }
</style>
