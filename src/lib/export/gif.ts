import { applyPalette, GIFEncoder, quantize, type Palette } from 'gifenc';
import type { Sequence } from '$lib/project/types';
import type { ExportSettings } from './presets';
import { roundEven } from './presets';
import { Eta, exportRange, openScene, throwIfAborted, yieldToBrowser, type GetMedia } from './scene';

export interface GifCallbacks {
  onProgress(progress: number, stage: string, eta: number | null): void;
  signal?: AbortSignal;
}

// 4x4 bayer matrix, spread over -0.5..0.5
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

// ordered dither before the palette lookup, cheap and it hides banding in
// gradients, which is where a 256 color gif hurts most
function dither(rgba: Uint8ClampedArray, width: number, height: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const n = bayer[(y & 3) * 4 + (x & 3)] * strength;
      out[i] = rgba[i] + n;
      out[i + 1] = rgba[i + 1] + n;
      out[i + 2] = rgba[i + 2] + n;
      out[i + 3] = 255;
    }
  }
  return out;
}

export async function exportGif(sequence: Sequence, settings: ExportSettings, callbacks: GifCallbacks, getMedia: GetMedia): Promise<Blob> {
  const { signal, onProgress } = callbacks;
  // a gif frame delay is whole hundredths of a second, so the rate is snapped
  // to one the format can hold and the animation keeps the length it should
  const wanted = Math.min(50, Math.max(1, settings.gif.fps));
  const centiseconds = Math.max(2, Math.round(100 / wanted));
  const fps = 100 / centiseconds;
  const width = roundEven(Math.min(settings.gif.width, sequence.width));
  const height = roundEven((width * sequence.height) / sequence.width);
  const { start, end } = exportRange(sequence, settings.range);
  const frames = Math.max(1, Math.round((end - start) * fps));
  const delay = centiseconds * 10;

  const scene = openScene(sequence, sequence.width, sequence.height, getMedia);
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Couldn't get a drawing context for the gif.");

  const grab = async (i: number): Promise<Uint8ClampedArray> => {
    throwIfAborted(signal);
    await scene.render(start + i / fps);
    ctx.drawImage(scene.canvas, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  };

  try {
    // without dithering a single palette from a handful of frames is good
    // enough and saves quantizing every frame, with it each frame gets its own
    let global: Palette | null = null;
    if (!settings.gif.dither) {
      const samples = Math.min(frames, 6);
      const step = frames / samples;
      const parts: Uint8ClampedArray[] = [];
      for (let s = 0; s < samples; s++) {
        parts.push(await grab(Math.floor(s * step)));
        onProgress((0.1 * s) / samples, 'Building the palette', null);
      }
      const all = new Uint8ClampedArray(parts.length * width * height * 4);
      parts.forEach((p, i) => all.set(p, i * p.length));
      global = quantize(all, 256, { format: 'rgb565' });
    }

    const encoder = GIFEncoder();
    const eta = new Eta(frames);
    const head = global ? 0.1 : 0;
    for (let i = 0; i < frames; i++) {
      let rgba = await grab(i);
      if (settings.gif.dither) rgba = dither(rgba, width, height, 24);
      const palette = global ?? quantize(rgba, 256, { format: 'rgb565' });
      const index = applyPalette(rgba, palette, 'rgb565');
      encoder.writeFrame(index, width, height, {
        palette,
        delay,
        repeat: settings.gif.loop ? 0 : -1
      });
      eta.tick();
      onProgress(head + ((1 - head) * (i + 1)) / frames, 'Rendering frames', eta.remaining(i + 1));
      if (i % 3 === 2) await yieldToBrowser();
    }
    encoder.finish();
    const bytes = encoder.bytes();
    return new Blob([bytes], { type: 'image/gif' });
  } finally {
    scene.close();
  }
}
