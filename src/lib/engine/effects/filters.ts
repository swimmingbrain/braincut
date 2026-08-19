// effect type to pixi filter. the registry stores friendly units (percent,
// degrees, pixels from the centre, hex colors), this is where they turn into
// what the shaders want. ctx is the rendered frame size and the clip-local
// time in seconds, so animated shaders stay deterministic for exports
import { BlurFilter, ColorMatrixFilter, NoiseFilter } from 'pixi.js';
import type { ColorMatrix, Filter } from 'pixi.js';
import {
  AdvancedBloomFilter, AsciiFilter, BulgePinchFilter, ColorGradientFilter, ColorOverlayFilter, ConvolutionFilter,
  CRTFilter, CrossHatchFilter, DotFilter, DropShadowFilter, EmbossFilter, GlitchFilter, GlowFilter, HslAdjustmentFilter,
  MotionBlurFilter, OldFilmFilter, OutlineFilter, PixelateFilter, RadialBlurFilter, ReflectionFilter, RGBSplitFilter,
  ShockwaveFilter, TiltShiftFilter, TwistFilter, ZoomBlurFilter
} from 'pixi-filters';
import type { ParamValue } from '$lib/project/types';
import { ChromaKeyFilter } from './shaders/chroma-key';
import { ColorBalanceFilter } from './shaders/color-balance';
import { ColorCorrectionFilter } from './shaders/color-correction';
import { LevelsFilter } from './shaders/levels';
import { LumaKeyFilter } from './shaders/luma-key';
import { MirrorFilter } from './shaders/mirror';
import { PosterizeFilter } from './shaders/posterize';
import { VignetteFilter } from './shaders/vignette';
import { setVec } from './shaders/common';
import { filterCompiles } from './shader-check';

export interface EffectContext {
  width: number;
  height: number;
  time: number;
  fps: number;
  // screen pixels per media pixel: pixi renders a filter at the size the layer
  // covers, so a length the user typed has to be converted or a blur would
  // grow every time the preview quality drops
  scale: number;
}

export interface VideoEffectRuntime {
  filter: Filter;
  update(params: Record<string, ParamValue>, ctx: EffectContext): void;
  destroy(): void;
}

type Params = Record<string, ParamValue>;

function num(p: Params, key: string, fallback = 0): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
// a length the user gave in media pixels, in the pixels the filter works in
function px(p: Params, key: string, fallback: number, ctx: EffectContext): number {
  return num(p, key, fallback) * ctx.scale;
}
function bool(p: Params, key: string, fallback = false): boolean {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
}
function str(p: Params, key: string, fallback = ''): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}
function point(p: Params, key: string): [number, number] {
  const v = p[key];
  return Array.isArray(v) ? [v[0], v[1]] : [0, 0];
}
function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}
export function hexToNumber(hex: string, fallback = 0): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  return m ? parseInt(m[1], 16) : fallback;
}
export function hexToRgb(hex: string, fallback = 0): [number, number, number] {
  const n = hexToNumber(hex, fallback);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function colorNum(p: Params, key: string, fallback = 0): number {
  return hexToNumber(str(p, key), fallback);
}
function colorRgb(p: Params, key: string, fallback = 0): [number, number, number] {
  return hexToRgb(str(p, key), fallback);
}
// point params are offsets from the frame centre, the shaders want pixels from the corner
function centre(p: Params, key: string, ctx: EffectContext): { x: number; y: number } {
  const [x, y] = point(p, key);
  return { x: (ctx.width / 2 + x) * ctx.scale, y: (ctx.height / 2 + y) * ctx.scale };
}
// a deterministic per-frame seed so scrubbing back gives the same grain
function frameSeed(ctx: EffectContext): number {
  const frame = Math.floor(ctx.time * ctx.fps);
  const s = Math.sin(frame * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const identity: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

function mixMatrix(a: ColorMatrix, b: ColorMatrix, t: number): ColorMatrix {
  return a.map((v, i) => v + (b[i] - v) * t) as ColorMatrix;
}

function runtime<F extends Filter>(filter: F, update: (f: F, p: Params, ctx: EffectContext) => void): VideoEffectRuntime {
  return {
    filter,
    update: (p, ctx) => update(filter, p, ctx),
    destroy: () => filter.destroy()
  };
}

const blurQuality: Record<string, number> = { low: 2, medium: 4, high: 8 };

const factories: Record<string, () => VideoEffectRuntime> = {
  'gaussian-blur': () => runtime(new BlurFilter({ strength: 10, quality: 4 }), (f, p, ctx) => {
    f.strength = px(p, 'strength', 10, ctx);
    f.quality = blurQuality[str(p, 'quality', 'medium')] ?? 4;
  }),

  'directional-blur': () => runtime(new MotionBlurFilter(), (f, p, ctx) => {
    const a = rad(num(p, 'angle'));
    const d = px(p, 'distance', 20, ctx);
    f.velocity = { x: Math.cos(a) * d, y: Math.sin(a) * d };
    f.kernelSize = Math.min(25, Math.max(5, Math.round(d / 4) * 2 + 1));
  }),

  'radial-blur': () => runtime(new RadialBlurFilter(), (f, p, ctx) => {
    f.angle = num(p, 'angle', 15);
    f.center = centre(p, 'center', ctx);
    const r = px(p, 'radius', 0, ctx);
    f.radius = r > 0 ? r : -1;
    f.kernelSize = Math.max(3, Math.round(num(p, 'quality', 9)) | 1);
  }),

  'zoom-blur': () => runtime(new ZoomBlurFilter(), (f, p, ctx) => {
    f.strength = num(p, 'strength', 10) / 100;
    f.center = centre(p, 'center', ctx);
    f.innerRadius = px(p, 'innerRadius', 0, ctx);
    f.radius = -1;
  }),

  sharpen: () => runtime(new ConvolutionFilter(), (f, p, ctx) => {
    const k = num(p, 'amount', 30) / 100;
    f.matrix = [0, -k, 0, -k, 1 + 4 * k, -k, 0, -k, 0];
    f.width = ctx.width * ctx.scale;
    f.height = ctx.height * ctx.scale;
  }),

  'tilt-shift': () => runtime(new TiltShiftFilter(), (f, p, ctx) => {
    f.blur = px(p, 'blur', 20, ctx);
    f.gradientBlur = px(p, 'gradient', 300, ctx);
    const h = ctx.height * ctx.scale;
    f.start = { x: 0, y: (h * num(p, 'start', 50)) / 100 };
    f.end = { x: ctx.width * ctx.scale, y: (h * num(p, 'end', 50)) / 100 };
  }),

  'color-correction': () => runtime(new ColorCorrectionFilter(), (f, p) => {
    const u = f.uniforms;
    u.uExposure = num(p, 'exposure');
    u.uContrast = num(p, 'contrast') / 100;
    u.uHighlights = num(p, 'highlights') / 100;
    u.uShadows = num(p, 'shadows') / 100;
    u.uWhites = num(p, 'whites') / 100;
    u.uBlacks = num(p, 'blacks') / 100;
    u.uTemperature = num(p, 'temperature') / 100;
    u.uTint = num(p, 'tint') / 100;
    u.uSaturation = num(p, 'saturation') / 100;
    u.uVibrance = num(p, 'vibrance') / 100;
  }),

  'brightness-contrast': () => runtime(new ColorMatrixFilter(), (f, p) => {
    f.reset();
    f.brightness(1 + num(p, 'brightness') / 100, false);
    f.contrast(num(p, 'contrast') / 100, true);
  }),

  'hue-saturation': () => runtime(new HslAdjustmentFilter(), (f, p) => {
    f.hue = num(p, 'hue');
    f.saturation = num(p, 'saturation') / 100;
    f.lightness = num(p, 'lightness') / 100;
    f.colorize = bool(p, 'colorize');
  }),

  levels: () => runtime(new LevelsFilter(), (f, p) => {
    const u = f.uniforms;
    u.uInputBlack = num(p, 'inputBlack') / 255;
    u.uInputWhite = num(p, 'inputWhite', 255) / 255;
    u.uGamma = Math.max(0.01, num(p, 'gamma', 1));
    u.uOutputBlack = num(p, 'outputBlack') / 255;
    u.uOutputWhite = num(p, 'outputWhite', 255) / 255;
  }),

  'black-white': () => runtime(new ColorMatrixFilter(), (f, p) => {
    f.reset();
    f.saturate(-num(p, 'amount', 100) / 100, false);
  }),

  invert: () => runtime(new ColorMatrixFilter(), (f, p) => {
    const t = num(p, 'amount', 100) / 100;
    const s = 1 - 2 * t;
    f.matrix = [s, 0, 0, 0, t, 0, s, 0, 0, t, 0, 0, s, 0, t, 0, 0, 0, 1, 0];
  }),

  tint: () => runtime(new ColorMatrixFilter(), (f, p) => {
    const [br, bg, bb] = colorRgb(p, 'black', 0x000000);
    const [wr, wg, wb] = colorRgb(p, 'white', 0xffffff);
    const t = num(p, 'amount', 100) / 100;
    // out = black + (white - black) * luma, so each row is the luma weights
    // scaled by the channel range plus the black level as offset
    const row = (b: number, w: number): [number, number, number, number, number] =>
      [0.2126 * (w - b), 0.7152 * (w - b), 0.0722 * (w - b), 0, b];
    const tinted: ColorMatrix = [...row(br, wr), ...row(bg, wg), ...row(bb, wb), 0, 0, 0, 1, 0];
    f.matrix = mixMatrix(identity, tinted, t);
  }),

  sepia: () => runtime(new ColorMatrixFilter(), (f, p) => {
    f.reset();
    f.sepia(false);
    f.matrix = mixMatrix(identity, f.matrix, num(p, 'amount', 100) / 100);
  }),

  'color-balance': () => runtime(new ColorBalanceFilter(), (f, p) => {
    const u = f.uniforms;
    setVec(u.uShadows, num(p, 'shadowRed') / 100, num(p, 'shadowGreen') / 100, num(p, 'shadowBlue') / 100);
    setVec(u.uMidtones, num(p, 'midtoneRed') / 100, num(p, 'midtoneGreen') / 100, num(p, 'midtoneBlue') / 100);
    setVec(u.uHighlights, num(p, 'highlightRed') / 100, num(p, 'highlightGreen') / 100, num(p, 'highlightBlue') / 100);
    u.uPreserveLuma = bool(p, 'preserveLuminosity', true) ? 1 : 0;
  }),

  'chroma-key': () => runtime(new ChromaKeyFilter(), (f, p) => {
    const u = f.uniforms;
    setVec(u.uKeyColor, ...colorRgb(p, 'color', 0x00ff00));
    u.uTolerance = (num(p, 'tolerance', 25) / 100) * 0.6;
    u.uSoftness = (num(p, 'softness', 10) / 100) * 0.6;
    u.uSpill = num(p, 'spill', 50) / 100;
    u.uEdgeThin = num(p, 'edgeThin') / 100;
    u.uFeather = (num(p, 'feather') / 100) * 8;
  }),

  'luma-key': () => runtime(new LumaKeyFilter(), (f, p) => {
    const u = f.uniforms;
    u.uThreshold = num(p, 'threshold', 20) / 100;
    u.uSoftness = num(p, 'softness', 10) / 100;
    u.uInvert = bool(p, 'invert') ? 1 : 0;
  }),

  vignette: () => runtime(new VignetteFilter(), (f, p) => {
    const u = f.uniforms;
    u.uAmount = num(p, 'amount', 50) / 100;
    u.uMidpoint = num(p, 'midpoint', 50) / 100;
    u.uRoundness = num(p, 'roundness') / 100;
    u.uFeather = num(p, 'feather', 50) / 100;
    setVec(u.uColor, ...colorRgb(p, 'color', 0));
  }),

  posterize: () => runtime(new PosterizeFilter(), (f, p) => {
    f.uniforms.uLevels = Math.max(2, Math.round(num(p, 'levels', 6)));
  }),

  pixelate: () => runtime(new PixelateFilter(), (f, p, ctx) => {
    f.size = Math.max(1, px(p, 'size', 10, ctx));
  }),

  noise: () => runtime(new NoiseFilter(), (f, p, ctx) => {
    f.noise = num(p, 'amount', 20) / 100;
    f.seed = bool(p, 'animated', true) ? frameSeed(ctx) : 0.5;
  }),

  glitch: () => {
    const f = new GlitchFilter({ slices: 6, offset: 60 });
    let lastTick = -1;
    return runtime(f, (f, p, ctx) => {
      const slices = Math.max(2, Math.round(num(p, 'slices', 6)));
      if (f.slices !== slices) f.slices = slices;
      f.offset = px(p, 'offset', 60, ctx);
      f.direction = num(p, 'direction');
      const shift = ((num(p, 'colorShift', 20) / 100) * 10) * ctx.scale;
      f.red = { x: shift, y: 0 };
      f.green = { x: -shift, y: 0 };
      f.blue = { x: 0, y: shift };
      // a new cut of slices a few times per second, not every frame
      const tick = bool(p, 'animated', true) ? Math.floor(ctx.time * 8) : 0;
      if (tick !== lastTick) {
        lastTick = tick;
        f.seed = frameSeed(ctx);
        f.refresh();
      }
    });
  },

  'rgb-split': () => runtime(new RGBSplitFilter(), (f, p, ctx) => {
    const shift = ([x, y]: [number, number]) => ({ x: x * ctx.scale, y: y * ctx.scale });
    f.red = shift(point(p, 'red'));
    f.green = shift(point(p, 'green'));
    f.blue = shift(point(p, 'blue'));
  }),

  emboss: () => runtime(new EmbossFilter(), (f, p) => {
    f.strength = num(p, 'strength', 5);
  }),

  'dot-screen': () => runtime(new DotFilter(), (f, p) => {
    f.scale = num(p, 'scale', 1);
    f.angle = rad(num(p, 'angle', 5));
    f.grayscale = bool(p, 'grayscale', true);
  }),

  'cross-hatch': () => runtime(new CrossHatchFilter(), () => {}),

  'old-film': () => runtime(new OldFilmFilter(), (f, p, ctx) => {
    f.sepia = num(p, 'sepia', 30) / 100;
    f.noise = num(p, 'noise', 30) / 100;
    f.noiseSize = num(p, 'noiseSize', 1);
    f.scratch = num(p, 'scratch', 50) / 100;
    f.scratchDensity = num(p, 'scratchDensity', 30) / 100;
    f.vignetting = num(p, 'vignette', 30) / 100;
    f.seed = frameSeed(ctx);
  }),

  crt: () => runtime(new CRTFilter(), (f, p, ctx) => {
    f.curvature = num(p, 'curvature', 1);
    f.lineWidth = num(p, 'lineWidth', 1);
    f.lineContrast = num(p, 'lineContrast', 25) / 100;
    f.verticalLine = bool(p, 'verticalLines');
    f.noise = num(p, 'noise', 30) / 100;
    f.vignetting = num(p, 'vignette', 30) / 100;
    f.time = ctx.time;
    f.seed = frameSeed(ctx);
  }),

  glow: () => runtime(new GlowFilter(), (f, p, ctx) => {
    f.distance = px(p, 'distance', 10, ctx);
    f.outerStrength = num(p, 'outerStrength', 4);
    f.innerStrength = num(p, 'innerStrength');
    f.color = colorNum(p, 'color', 0xffffff);
  }),

  bloom: () => runtime(new AdvancedBloomFilter(), (f, p, ctx) => {
    f.threshold = num(p, 'threshold', 50) / 100;
    f.bloomScale = num(p, 'intensity', 1);
    f.brightness = num(p, 'brightness', 1);
    f.blur = px(p, 'blur', 8, ctx);
  }),

  'drop-shadow': () => runtime(new DropShadowFilter(), (f, p, ctx) => {
    const [x, y] = point(p, 'offset');
    f.offset = { x: x * ctx.scale, y: y * ctx.scale };
    f.blur = px(p, 'blur', 4, ctx);
    f.color = colorNum(p, 'color', 0);
    f.alpha = num(p, 'opacity', 60) / 100;
  }),

  outline: () => runtime(new OutlineFilter(), (f, p, ctx) => {
    f.thickness = px(p, 'thickness', 2, ctx);
    f.color = colorNum(p, 'color', 0xffffff);
    f.alpha = num(p, 'opacity', 100) / 100;
  }),

  ascii: () => runtime(new AsciiFilter(), (f, p, ctx) => {
    f.size = Math.max(2, px(p, 'size', 8, ctx));
    f.color = colorNum(p, 'color', 0xffffff);
    f.replaceColor = bool(p, 'replaceColor');
  }),

  mosaic: () => runtime(new PixelateFilter(), (f, p, ctx) => {
    f.size = [Math.max(1, px(p, 'width', 16, ctx)), Math.max(1, px(p, 'height', 16, ctx))];
  }),

  twist: () => runtime(new TwistFilter(), (f, p, ctx) => {
    f.angle = rad(num(p, 'angle', 90));
    f.radius = px(p, 'radius', 300, ctx);
    f.offset = centre(p, 'center', ctx);
  }),

  'bulge-pinch': () => runtime(new BulgePinchFilter(), (f, p, ctx) => {
    const [x, y] = point(p, 'center');
    f.center = { x: 0.5 + x / ctx.width, y: 0.5 + y / ctx.height };
    f.radius = px(p, 'radius', 300, ctx);
    f.strength = num(p, 'strength', 50) / 100;
  }),

  shockwave: () => runtime(new ShockwaveFilter(), (f, p, ctx) => {
    f.center = centre(p, 'center', ctx);
    f.speed = px(p, 'speed', 500, ctx);
    f.amplitude = px(p, 'amplitude', 30, ctx);
    f.wavelength = px(p, 'wavelength', 160, ctx);
    f.brightness = num(p, 'brightness', 1);
    const r = px(p, 'radius', 0, ctx);
    f.radius = r > 0 ? r : -1;
    f.time = Math.max(0, ctx.time - num(p, 'startTime'));
  }),

  reflection: () => runtime(new ReflectionFilter(), (f, p, ctx) => {
    f.mirror = bool(p, 'mirror', true);
    f.boundary = num(p, 'boundary', 50) / 100;
    const amp = px(p, 'amplitude', 20, ctx);
    const wl = px(p, 'wavelength', 60, ctx);
    const alpha = num(p, 'opacity', 70) / 100;
    f.amplitude = [amp, amp * 0.5];
    f.waveLength = [wl, wl * 2];
    f.alpha = [alpha, alpha * 0.7];
    f.time = ctx.time * num(p, 'speed', 1);
  }),

  'lens-distortion': () => runtime(new BulgePinchFilter(), (f, p, ctx) => {
    f.center = { x: 0.5, y: 0.5 };
    f.radius = (Math.hypot(ctx.width, ctx.height) / 2) * ctx.scale;
    f.strength = num(p, 'amount', 20) / 100;
  }),

  mirror: () => runtime(new MirrorFilter(), (f, p) => {
    const axes: Record<string, number> = { vertical: 0, 'vertical-reverse': 1, horizontal: 2, 'horizontal-reverse': 3 };
    f.uniforms.uAxis = axes[str(p, 'axis', 'vertical')] ?? 0;
    f.uniforms.uCenter = num(p, 'center', 50) / 100;
  }),

  'color-overlay': () => runtime(new ColorOverlayFilter(), (f, p) => {
    f.color = colorNum(p, 'color', 0xd19a66);
    f.alpha = num(p, 'opacity', 50) / 100;
  }),

  'gradient-overlay': () => {
    const f = new ColorGradientFilter({
      type: ColorGradientFilter.LINEAR,
      stops: [{ offset: 0, color: 0x000000, alpha: 1 }, { offset: 1, color: 0xffffff, alpha: 1 }]
    });
    let last = '';
    return runtime(f, (f, p) => {
      const start = colorNum(p, 'startColor', 0x000000);
      const end = colorNum(p, 'endColor', 0xffffff);
      // stops rebuild the uniform arrays, only do it when they changed
      const key = `${start}:${end}`;
      if (key !== last) {
        last = key;
        f.stops = [{ offset: 0, color: start, alpha: 1 }, { offset: 1, color: end, alpha: 1 }];
      }
      f.type = str(p, 'shape', 'linear') === 'radial' ? ColorGradientFilter.RADIAL : ColorGradientFilter.LINEAR;
      f.angle = num(p, 'angle', 90);
      f.alpha = num(p, 'opacity', 50) / 100;
    });
  }
};

// transform, opacity, crop and flip are not filters, the compositor places
// and masks the layer itself, so they have no runtime here
export function createVideoEffect(type: string): VideoEffectRuntime | null {
  const factory = factories[type];
  if (!factory) return null;
  const made = factory();
  // a shader that will not build here would paint black, no effect at all is
  // the better answer
  if (!filterCompiles(made.filter, `effect ${type}`)) {
    made.destroy();
    return null;
  }
  return made;
}

export function hasVideoEffectRuntime(type: string): boolean {
  return type in factories;
}
