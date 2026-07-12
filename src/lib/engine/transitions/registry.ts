// the curated list of transitions. video ones wrap a gl-transition and give
// it a name people recognise from a desktop nle, audio ones are just curves
import transitions from 'gl-transitions';
import type { GlTransition } from 'gl-transitions';
import type { ParamValue, Transition } from '$lib/project/types';
import { id as newId } from '$lib/project/ids';
import type { ParamDef } from '../effects/registry';
import type { GlParamType } from './glsl';

export interface TransitionDef {
  id: string;
  name: string;
  group: string;
  kind: 'video' | 'audio';
  glslId?: string;
  defaultParams: Record<string, ParamValue>;
  params: ParamDef[];
  description?: string;
}

export const transitionGroups = ['Dissolve', 'Wipe', 'Slide & Push', '3D & Motion', 'Zoom', 'Stylize', 'Audio'];

export const defaultTransitionDuration = 1;
export const defaultVideoTransition = 'cross-dissolve';
export const defaultAudioTransition = 'crossfade';

interface Curated {
  id: string;
  name: string;
  group: string;
  glslId: string;
  // friendlier labels, ranges or defaults for the gl params
  overrides?: Record<string, Partial<ParamDef>>;
  description?: string;
}

const dissolve: Curated[] = [
  { id: 'cross-dissolve', name: 'Cross Dissolve', group: 'Dissolve', glslId: 'fade' },
  { id: 'dip-to-black', name: 'Dip to Black', group: 'Dissolve', glslId: 'fadecolor', overrides: { color: { default: '#000000' }, colorPhase: { label: 'Hold' } } },
  { id: 'dip-to-white', name: 'Dip to White', group: 'Dissolve', glslId: 'fadecolor', overrides: { color: { default: '#ffffff' }, colorPhase: { label: 'Hold' } } },
  { id: 'dip-to-gray', name: 'Dip to Gray', group: 'Dissolve', glslId: 'fadegrayscale' },
  { id: 'film-dissolve', name: 'Film Dissolve', group: 'Dissolve', glslId: 'dissolve', overrides: { uLineWidth: { label: 'Edge Width' }, uSpreadClr: { label: 'Edge Color' }, uHotClr: { label: 'Hot Color' }, uPow: { label: 'Falloff' }, uIntensity: { label: 'Intensity' } } },
  { id: 'morph', name: 'Morph', group: 'Dissolve', glslId: 'morph' },
  { id: 'dreamy', name: 'Dreamy', group: 'Dissolve', glslId: 'Dreamy' },
  { id: 'cross-warp', name: 'Cross Warp', group: 'Dissolve', glslId: 'crosswarp' },
  { id: 'static', name: 'Static', group: 'Dissolve', glslId: 'StaticFade', overrides: { n_noise_pixels: { label: 'Grain', min: 10, max: 1000 }, static_luminosity: { label: 'Brightness' } } },
  { id: 'blur-dissolve', name: 'Blur Dissolve', group: 'Dissolve', glslId: 'LinearBlur' },
  { id: 'defocus', name: 'Defocus', group: 'Dissolve', glslId: 'DefocusBlur', overrides: { blurSize: { max: 0.2 } } },
  { id: 'color-phase', name: 'Color Phase', group: 'Dissolve', glslId: 'colorphase' },
  { id: 'perlin', name: 'Perlin', group: 'Dissolve', glslId: 'perlin', overrides: { seed: { animatable: false } } }
];

const wipe: Curated[] = [
  { id: 'wipe-left', name: 'Wipe Left', group: 'Wipe', glslId: 'wipeLeft' },
  { id: 'wipe-right', name: 'Wipe Right', group: 'Wipe', glslId: 'wipeRight' },
  { id: 'wipe-up', name: 'Wipe Up', group: 'Wipe', glslId: 'wipeUp' },
  { id: 'wipe-down', name: 'Wipe Down', group: 'Wipe', glslId: 'wipeDown' },
  { id: 'directional-wipe', name: 'Directional Wipe', group: 'Wipe', glslId: 'directionalwipe' },
  { id: 'clock-wipe', name: 'Clock Wipe', group: 'Wipe', glslId: 'angular', overrides: { startingAngle: { label: 'Start Angle', min: 0, max: 360 } } },
  { id: 'circle-wipe', name: 'Circle Wipe', group: 'Wipe', glslId: 'circleopen' },
  { id: 'circle', name: 'Circle', group: 'Wipe', glslId: 'circle', overrides: { backColor: { label: 'Background' } } },
  { id: 'slices', name: 'Slices', group: 'Wipe', glslId: 'windowslice', overrides: { count: { min: 1, max: 100 } } },
  { id: 'blinds', name: 'Blinds', group: 'Wipe', glslId: 'windowblinds' },
  { id: 'checkerboard', name: 'Checkerboard', group: 'Wipe', glslId: 'chessboard', overrides: { grid_num: { label: 'Grid', min: 2, max: 40 } } },
  { id: 'random-blocks', name: 'Random Blocks', group: 'Wipe', glslId: 'randomsquares' },
  { id: 'radial-wipe', name: 'Radial Wipe', group: 'Wipe', glslId: 'Radial' },
  { id: 'star-wipe', name: 'Star Wipe', group: 'Wipe', glslId: 'StarWipe', overrides: { border_thickness: { label: 'Border', max: 0.1 }, star_rotation: { label: 'Rotation' }, border_color: { label: 'Border Color' }, star_center: { label: 'Center' } } },
  { id: 'heart', name: 'Heart', group: 'Wipe', glslId: 'heart' },
  { id: 'hexagons', name: 'Hexagons', group: 'Wipe', glslId: 'hexagonalize', overrides: { horizontalHexagons: { label: 'Columns', min: 1, max: 100 } } },
  { id: 'squares', name: 'Squares', group: 'Wipe', glslId: 'squareswire' },
  { id: 'wind', name: 'Wind', group: 'Wipe', glslId: 'wind' }
];

const push: Curated[] = [
  { id: 'push-left', name: 'Push Left', group: 'Slide & Push', glslId: 'Directional', overrides: { direction: { default: [1, 0] } } },
  { id: 'push-right', name: 'Push Right', group: 'Slide & Push', glslId: 'Directional', overrides: { direction: { default: [-1, 0] } } },
  { id: 'push-up', name: 'Push Up', group: 'Slide & Push', glslId: 'Directional', overrides: { direction: { default: [0, -1] } } },
  { id: 'push-down', name: 'Push Down', group: 'Slide & Push', glslId: 'Directional', overrides: { direction: { default: [0, 1] } } },
  { id: 'split-horizontal', name: 'Split Horizontal', group: 'Slide & Push', glslId: 'LeftRight' },
  { id: 'split-vertical', name: 'Split Vertical', group: 'Slide & Push', glslId: 'TopBottom' },
  { id: 'slides', name: 'Slides', group: 'Slide & Push', glslId: 'Slides', overrides: { type: { label: 'Edge', min: 0, max: 8 }, In: { label: 'Slide In' } } },
  { id: 'bounce', name: 'Bounce', group: 'Slide & Push', glslId: 'Bounce', overrides: { shadow_colour: { label: 'Shadow' }, shadow_height: { label: 'Shadow Height' } } },
  { id: 'swap', name: 'Swap', group: 'Slide & Push', glslId: 'swap' },
  { id: 'squeeze', name: 'Squeeze', group: 'Slide & Push', glslId: 'squeeze', overrides: { colorSeparation: { label: 'Color Separation' } } },
  { id: 'doorway', name: 'Doorway', group: 'Slide & Push', glslId: 'doorway' }
];

const motion: Curated[] = [
  { id: 'cube', name: 'Cube', group: '3D & Motion', glslId: 'cube', overrides: { persp: { label: 'Perspective' } } },
  { id: 'rotate-fade', name: 'Rotate & Fade', group: '3D & Motion', glslId: 'rotate_scale_fade', overrides: { backColor: { label: 'Background' } } },
  { id: 'roll', name: 'Roll', group: '3D & Motion', glslId: 'Rolls', overrides: { type: { label: 'Corner', min: 0, max: 3 }, RotDown: { label: 'Roll Down' } } },
  { id: 'flip', name: 'Flip', group: '3D & Motion', glslId: 'SimpleFlip' },
  { id: 'page-curl', name: 'Page Curl', group: '3D & Motion', glslId: 'InvertedPageCurl' },
  { id: 'grid-flip', name: 'Grid Flip', group: '3D & Motion', glslId: 'GridFlip', overrides: { dividerWidth: { label: 'Divider' }, bgcolor: { label: 'Background' } } },
  { id: 'book-flip', name: 'Book Flip', group: '3D & Motion', glslId: 'BookFlip' },
  { id: 'fold', name: 'Fold', group: '3D & Motion', glslId: 'Fold' },
  { id: 'swirl', name: 'Swirl', group: '3D & Motion', glslId: 'Swirl' },
  { id: 'pinwheel', name: 'Pinwheel', group: '3D & Motion', glslId: 'pinwheel' },
  { id: 'kaleidoscope', name: 'Kaleidoscope', group: '3D & Motion', glslId: 'kaleidoscope' },
  { id: 'water-drop', name: 'Water Drop', group: '3D & Motion', glslId: 'WaterDrop', overrides: { amplitude: { max: 100 }, speed: { max: 100 } } },
  { id: 'ripple', name: 'Ripple', group: '3D & Motion', glslId: 'ripple', overrides: { amplitude: { max: 300 }, speed: { max: 200 } } }
];

const zoom: Curated[] = [
  { id: 'zoom-in', name: 'Zoom In', group: 'Zoom', glslId: 'SimpleZoom', overrides: { zoom_quickness: { label: 'Quickness' } } },
  { id: 'cross-zoom', name: 'Cross Zoom', group: 'Zoom', glslId: 'CrossZoom' },
  { id: 'zoom-circles', name: 'Zoom Circles', group: 'Zoom', glslId: 'ZoomInCircles' }
];

const stylize: Curated[] = [
  { id: 'burn', name: 'Burn', group: 'Stylize', glslId: 'burn' },
  { id: 'film-burn', name: 'Film Burn', group: 'Stylize', glslId: 'FilmBurn', overrides: { Seed: { label: 'Seed', min: 0, max: 10, animatable: false } } },
  { id: 'glitch', name: 'Glitch', group: 'Stylize', glslId: 'GlitchMemories' },
  { id: 'glitch-displace', name: 'Glitch Displace', group: 'Stylize', glslId: 'GlitchDisplace' },
  { id: 'pixelate', name: 'Pixelate', group: 'Stylize', glslId: 'pixelize', overrides: { squaresMin: { label: 'Smallest Grid' } } },
  { id: 'mosaic', name: 'Mosaic', group: 'Stylize', glslId: 'Mosaic', overrides: { endx: { label: 'End Column', min: -5, max: 5 }, endy: { label: 'End Row', min: -5, max: 5 } } },
  { id: 'tv-static', name: 'TV Static', group: 'Stylize', glslId: 'TVStatic' },
  { id: 'doom', name: 'Doom', group: 'Stylize', glslId: 'DoomScreenTransition', overrides: { dripScale: { label: 'Drip' } } },
  { id: 'fly-eye', name: 'Fly Eye', group: 'Stylize', glslId: 'flyeye', overrides: { colorSeparation: { label: 'Color Separation' } } }
];

const byGlslId = new Map(transitions.map((t) => [t.name, t]));

export function glTransition(glslId: string): GlTransition | undefined {
  return byGlslId.get(glslId);
}

function humanize(key: string): string {
  return key
    .replace(/^u(?=[A-Z])/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\bclr\b/i, 'color')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const colorNames = /col(?:ou)?r|clr/i;

function toHex(rgb: number[]): string {
  return '#' + rgb.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

// range guesses for the params gl-transitions only describe by a default
function numberRange(def: number, isInt: boolean): { min: number; max: number; step: number } {
  if (isInt) return { min: Math.min(0, def), max: Math.max(10, def * 4), step: 1 };
  const abs = Math.abs(def);
  if (abs <= 1) return { min: def < 0 ? -1 : 0, max: 1, step: 0.01 };
  if (abs <= 10) return { min: 0, max: 20, step: 0.1 };
  return { min: 0, max: Math.ceil(abs * 4), step: 1 };
}

function paramFromGl(key: string, type: GlParamType, def: number | boolean | number[]): ParamDef | null {
  const label = humanize(key);
  switch (type) {
    case 'float':
    case 'int': {
      const value = typeof def === 'number' ? def : 0;
      return { key, label, kind: 'number', ...numberRange(value, type === 'int'), default: value, animatable: true };
    }
    case 'bool':
      return { key, label, kind: 'boolean', default: !!def, animatable: false };
    case 'vec2':
    case 'ivec2': {
      const v = Array.isArray(def) ? def : [0, 0];
      return { key, label, kind: 'point', unit: '', step: type === 'ivec2' ? 1 : 0.01, default: [v[0], v[1]], animatable: true };
    }
    case 'vec3':
      return { key, label, kind: 'color', default: toHex(Array.isArray(def) ? def : [0, 0, 0]), animatable: true };
    case 'vec4':
      // a vec4 that is not a color has no home in ParamValue, the filter keeps the gl default
      if (!colorNames.test(key)) return null;
      return { key, label, kind: 'color', default: toHex(Array.isArray(def) ? def : [0, 0, 0, 1]), animatable: true };
    default:
      return null;
  }
}

function buildDef(c: Curated): TransitionDef {
  const gl = byGlslId.get(c.glslId);
  if (!gl) throw new Error(`gl-transition ${c.glslId} not found`);
  const params: ParamDef[] = [];
  for (const [key, type] of Object.entries(gl.paramsTypes)) {
    const p = paramFromGl(key, type, gl.defaultParams[key]);
    if (!p) continue;
    params.push({ ...p, ...c.overrides?.[key] });
  }
  const defaultParams: Record<string, ParamValue> = {};
  for (const p of params) defaultParams[p.key] = Array.isArray(p.default) ? [p.default[0], p.default[1]] : p.default;
  return { id: c.id, name: c.name, group: c.group, kind: 'video', glslId: c.glslId, defaultParams, params, description: c.description };
}

const audio: TransitionDef[] = [
  { id: 'crossfade', name: 'Constant Power', group: 'Audio', kind: 'audio', defaultParams: {}, params: [], description: 'Equal loudness through the middle' },
  { id: 'constant-gain', name: 'Constant Gain', group: 'Audio', kind: 'audio', defaultParams: {}, params: [], description: 'Straight lines, dips a little in the middle' },
  { id: 'exponential-fade', name: 'Exponential Fade', group: 'Audio', kind: 'audio', defaultParams: {}, params: [], description: 'Fades out fast, comes in late' }
];

export const transitionDefs: TransitionDef[] = [
  ...[...dissolve, ...wipe, ...push, ...motion, ...zoom, ...stylize].map(buildDef),
  ...audio
];

const byId = new Map(transitionDefs.map((d) => [d.id, d]));

export function transitionDef(id: string): TransitionDef | undefined {
  return byId.get(id);
}

export function transitionsInGroup(group: string): TransitionDef[] {
  return transitionDefs.filter((d) => d.group === group);
}

export function isAudioTransitionType(type: string): boolean {
  return byId.get(type)?.kind === 'audio';
}

export function createTransition(type: string, leftClipId: string | null, rightClipId: string | null, start: number, duration: number): Transition {
  const def = byId.get(type);
  if (!def) throw new Error(`Unknown transition type: ${type}`);
  const params: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(def.defaultParams)) params[k] = Array.isArray(v) ? [v[0], v[1]] : v;
  return { id: newId(), type, leftClipId, rightClipId, start, duration, params };
}

// gains of the outgoing and incoming clip at a point of the transition.
// video transitions on linked audio get the constant power curve too
export function transitionCurve(type: string, progress: number): { outGain: number; inGain: number } {
  const p = Math.min(1, Math.max(0, progress));
  switch (type) {
    case 'constant-gain':
      return { outGain: 1 - p, inGain: p };
    case 'exponential-fade':
      return { outGain: (1 - p) * (1 - p), inGain: p * p };
    default:
      return { outGain: Math.cos((p * Math.PI) / 2), inGain: Math.sin((p * Math.PI) / 2) };
  }
}
