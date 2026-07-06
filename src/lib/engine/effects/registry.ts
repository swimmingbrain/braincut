// everything the effects panel lists and the effect controls edit. the
// definitions are plain data so this module can be tested in node and so the
// project file only has to store type + params, never behaviour
import type { EffectInstance, Keyframe, ParamValue } from '$lib/project/types';
import { id } from '$lib/project/ids';

export type ParamKind = 'number' | 'boolean' | 'color' | 'select' | 'point' | 'angle';

export interface ParamDef {
  key: string;
  label: string;
  kind: ParamKind;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  default: ParamValue;
  options?: { value: string; label: string }[];
  animatable: boolean;
}

export interface EffectDef {
  type: string;
  name: string;
  group: string;
  kind: 'video' | 'audio' | 'fixed';
  params: ParamDef[];
  description?: string;
}

export const videoEffectGroups = [
  'Blur & Sharpen',
  'Color Correction',
  'Keying',
  'Stylize',
  'Distort',
  'Transform',
  'Generate'
];

export const audioEffectGroups = ['Amplitude', 'Filter & EQ', 'Dynamics', 'Reverb & Delay', 'Stereo'];

type Opt = Partial<Pick<ParamDef, 'min' | 'max' | 'step' | 'unit' | 'animatable'>>;

// small builders keep the list below readable. everything is animatable
// unless said otherwise, which matches what people expect from an nle
function num(key: string, label: string, def: number, min: number, max: number, opt: Opt = {}): ParamDef {
  return { key, label, kind: 'number', min, max, step: opt.step ?? 1, unit: opt.unit, default: def, animatable: opt.animatable ?? true };
}
function pct(key: string, label: string, def: number, min = 0, max = 100, opt: Opt = {}): ParamDef {
  return num(key, label, def, min, max, { unit: '%', ...opt });
}
function px(key: string, label: string, def: number, min: number, max: number, opt: Opt = {}): ParamDef {
  return num(key, label, def, min, max, { unit: 'px', ...opt });
}
function angle(key: string, label: string, def: number, min = -360, max = 360, opt: Opt = {}): ParamDef {
  return { key, label, kind: 'angle', min, max, step: opt.step ?? 1, unit: '°', default: def, animatable: opt.animatable ?? true };
}
function bool(key: string, label: string, def: boolean, animatable = false): ParamDef {
  return { key, label, kind: 'boolean', default: def, animatable };
}
function color(key: string, label: string, def: string, animatable = true): ParamDef {
  return { key, label, kind: 'color', default: def, animatable };
}
function point(key: string, label: string, def: [number, number], opt: Opt = {}): ParamDef {
  return { key, label, kind: 'point', unit: opt.unit ?? 'px', step: opt.step ?? 1, default: def, animatable: opt.animatable ?? true };
}
function select(key: string, label: string, def: string, options: { value: string; label: string }[]): ParamDef {
  return { key, label, kind: 'select', default: def, options, animatable: false };
}
function db(key: string, label: string, def: number, min: number, max: number, opt: Opt = {}): ParamDef {
  return num(key, label, def, min, max, { unit: 'dB', step: 0.1, ...opt });
}
function hz(key: string, label: string, def: number, min: number, max: number): ParamDef {
  return num(key, label, def, min, max, { unit: 'Hz' });
}

const centerPoint = (key = 'center', label = 'Center') => point(key, label, [0, 0]);

const blendModes = ['normal', 'add', 'screen', 'darken', 'lighten', 'multiply', 'overlay', 'difference', 'exclusion',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light'];

const fixedVideo: EffectDef[] = [
  {
    type: 'transform',
    name: 'Motion',
    group: 'Transform',
    kind: 'fixed',
    params: [
      point('position', 'Position', [0, 0]),
      pct('scale', 'Scale', 100, 0, 1000, { step: 0.1 }),
      pct('scaleY', 'Scale Height', 100, 0, 1000, { step: 0.1 }),
      bool('uniformScale', 'Uniform Scale', true),
      angle('rotation', 'Rotation', 0, -3600, 3600, { step: 0.1 }),
      point('anchor', 'Anchor Point', [0, 0]),
      bool('flipH', 'Flip Horizontal', false),
      bool('flipV', 'Flip Vertical', false)
    ]
  },
  {
    type: 'opacity',
    name: 'Opacity',
    group: 'Transform',
    kind: 'fixed',
    params: [
      pct('opacity', 'Opacity', 100, 0, 100, { step: 0.1 }),
      select('blendMode', 'Blend Mode', 'normal', blendModes.map((value) => ({ value, label: value.replace('-', ' ') })))
    ]
  }
];

const fixedAudio: EffectDef[] = [
  { type: 'volume', name: 'Volume', group: 'Amplitude', kind: 'fixed', params: [db('level', 'Level', 0, -60, 12)] },
  { type: 'pan', name: 'Panner', group: 'Stereo', kind: 'fixed', params: [num('pan', 'Balance', 0, -100, 100)] }
];

const blur: EffectDef[] = [
  {
    type: 'gaussian-blur', name: 'Gaussian Blur', group: 'Blur & Sharpen', kind: 'video',
    params: [
      px('strength', 'Blurriness', 10, 0, 200, { step: 0.5 }),
      select('quality', 'Quality', 'medium', [
        { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }
      ])
    ]
  },
  {
    type: 'directional-blur', name: 'Directional Blur', group: 'Blur & Sharpen', kind: 'video',
    params: [angle('angle', 'Direction', 0), px('distance', 'Blur Length', 20, 0, 300)]
  },
  {
    type: 'radial-blur', name: 'Radial Blur', group: 'Blur & Sharpen', kind: 'video',
    params: [angle('angle', 'Amount', 15, -180, 180), centerPoint(), px('radius', 'Radius', 0, 0, 4000), num('quality', 'Quality', 9, 3, 25, { step: 2, animatable: false })],
    description: 'Radius 0 blurs the whole frame'
  },
  {
    type: 'zoom-blur', name: 'Zoom Blur', group: 'Blur & Sharpen', kind: 'video',
    params: [pct('strength', 'Amount', 10, 0, 100), centerPoint(), px('innerRadius', 'Sharp Radius', 0, 0, 4000)]
  },
  {
    type: 'sharpen', name: 'Sharpen', group: 'Blur & Sharpen', kind: 'video',
    params: [pct('amount', 'Amount', 30, 0, 200)]
  },
  {
    type: 'tilt-shift', name: 'Tilt Shift', group: 'Blur & Sharpen', kind: 'video',
    params: [px('blur', 'Blur', 20, 0, 200), px('gradient', 'Gradient', 300, 0, 2000), pct('start', 'Focus Left', 50), pct('end', 'Focus Right', 50)]
  }
];

const colorCorrection: EffectDef[] = [
  {
    type: 'color-correction', name: 'Color Correction', group: 'Color Correction', kind: 'video',
    params: [
      num('exposure', 'Exposure', 0, -5, 5, { step: 0.01, unit: 'EV' }),
      num('contrast', 'Contrast', 0, -100, 100),
      num('highlights', 'Highlights', 0, -100, 100),
      num('shadows', 'Shadows', 0, -100, 100),
      num('whites', 'Whites', 0, -100, 100),
      num('blacks', 'Blacks', 0, -100, 100),
      num('temperature', 'Temperature', 0, -100, 100),
      num('tint', 'Tint', 0, -100, 100),
      num('saturation', 'Saturation', 0, -100, 100),
      num('vibrance', 'Vibrance', 0, -100, 100)
    ]
  },
  {
    type: 'brightness-contrast', name: 'Brightness & Contrast', group: 'Color Correction', kind: 'video',
    params: [num('brightness', 'Brightness', 0, -100, 100), num('contrast', 'Contrast', 0, -100, 100)]
  },
  {
    type: 'hue-saturation', name: 'Hue/Saturation', group: 'Color Correction', kind: 'video',
    params: [angle('hue', 'Hue', 0, -180, 180), num('saturation', 'Saturation', 0, -100, 100), num('lightness', 'Lightness', 0, -100, 100), bool('colorize', 'Colorize', false)]
  },
  {
    type: 'levels', name: 'Levels', group: 'Color Correction', kind: 'video',
    params: [
      num('inputBlack', 'Input Black', 0, 0, 255), num('inputWhite', 'Input White', 255, 0, 255),
      num('gamma', 'Gamma', 1, 0.1, 10, { step: 0.01 }),
      num('outputBlack', 'Output Black', 0, 0, 255), num('outputWhite', 'Output White', 255, 0, 255)
    ]
  },
  { type: 'black-white', name: 'Black & White', group: 'Color Correction', kind: 'video', params: [pct('amount', 'Amount', 100)] },
  { type: 'invert', name: 'Invert', group: 'Color Correction', kind: 'video', params: [pct('amount', 'Amount', 100)] },
  {
    type: 'tint', name: 'Tint', group: 'Color Correction', kind: 'video',
    params: [color('black', 'Map Black To', '#000000'), color('white', 'Map White To', '#ffffff'), pct('amount', 'Amount', 100)]
  },
  { type: 'sepia', name: 'Sepia', group: 'Color Correction', kind: 'video', params: [pct('amount', 'Amount', 100)] },
  {
    type: 'color-balance', name: 'Color Balance', group: 'Color Correction', kind: 'video',
    params: [
      num('shadowRed', 'Shadow Red', 0, -100, 100), num('shadowGreen', 'Shadow Green', 0, -100, 100), num('shadowBlue', 'Shadow Blue', 0, -100, 100),
      num('midtoneRed', 'Midtone Red', 0, -100, 100), num('midtoneGreen', 'Midtone Green', 0, -100, 100), num('midtoneBlue', 'Midtone Blue', 0, -100, 100),
      num('highlightRed', 'Highlight Red', 0, -100, 100), num('highlightGreen', 'Highlight Green', 0, -100, 100), num('highlightBlue', 'Highlight Blue', 0, -100, 100),
      bool('preserveLuminosity', 'Preserve Luminosity', true)
    ]
  }
];

const keying: EffectDef[] = [
  {
    type: 'chroma-key', name: 'Chroma Key', group: 'Keying', kind: 'video',
    params: [
      color('color', 'Key Color', '#00ff00'),
      pct('tolerance', 'Tolerance', 25), pct('softness', 'Softness', 10), pct('spill', 'Spill Suppression', 50),
      num('edgeThin', 'Edge Thin', 0, -100, 100), pct('feather', 'Edge Feather', 0)
    ]
  },
  {
    type: 'luma-key', name: 'Luma Key', group: 'Keying', kind: 'video',
    params: [pct('threshold', 'Threshold', 20), pct('softness', 'Softness', 10), bool('invert', 'Key Bright Areas', false)]
  }
];

const stylize: EffectDef[] = [
  {
    type: 'vignette', name: 'Vignette', group: 'Stylize', kind: 'video',
    params: [
      pct('amount', 'Amount', 50), pct('midpoint', 'Midpoint', 50), num('roundness', 'Roundness', 0, -100, 100),
      pct('feather', 'Feather', 50), color('color', 'Color', '#000000')
    ]
  },
  { type: 'posterize', name: 'Posterize', group: 'Stylize', kind: 'video', params: [num('levels', 'Levels', 6, 2, 64)] },
  { type: 'pixelate', name: 'Pixelate', group: 'Stylize', kind: 'video', params: [px('size', 'Cell Size', 10, 1, 200)] },
  {
    type: 'noise', name: 'Noise', group: 'Stylize', kind: 'video',
    params: [pct('amount', 'Amount', 20), bool('animated', 'Animate', true)]
  },
  {
    type: 'glitch', name: 'Glitch', group: 'Stylize', kind: 'video',
    params: [
      num('slices', 'Slices', 6, 2, 60, { animatable: false }), px('offset', 'Offset', 60, 0, 600),
      angle('direction', 'Direction', 0, -180, 180), pct('colorShift', 'Color Shift', 20), bool('animated', 'Animate', true)
    ]
  },
  {
    type: 'rgb-split', name: 'RGB Split', group: 'Stylize', kind: 'video',
    params: [point('red', 'Red', [-6, 0]), point('green', 'Green', [0, 6]), point('blue', 'Blue', [0, 0])]
  },
  { type: 'emboss', name: 'Emboss', group: 'Stylize', kind: 'video', params: [num('strength', 'Strength', 5, 0, 20, { step: 0.1 })] },
  {
    type: 'dot-screen', name: 'Dot Screen', group: 'Stylize', kind: 'video',
    params: [num('scale', 'Scale', 1, 0.3, 5, { step: 0.05 }), angle('angle', 'Angle', 5, 0, 180), bool('grayscale', 'Grayscale', true)]
  },
  { type: 'cross-hatch', name: 'Cross Hatch', group: 'Stylize', kind: 'video', params: [] },
  {
    type: 'old-film', name: 'Old Film', group: 'Stylize', kind: 'video',
    params: [
      pct('sepia', 'Sepia', 30), pct('noise', 'Grain', 30), num('noiseSize', 'Grain Size', 1, 1, 10, { step: 0.5 }),
      pct('scratch', 'Scratches', 50), pct('scratchDensity', 'Scratch Density', 30), pct('vignette', 'Vignette', 30)
    ]
  },
  {
    type: 'crt', name: 'CRT', group: 'Stylize', kind: 'video',
    params: [
      num('curvature', 'Curvature', 1, 0, 10, { step: 0.1 }), px('lineWidth', 'Line Width', 1, 0, 5, { step: 0.1 }), pct('lineContrast', 'Line Contrast', 25),
      pct('noise', 'Noise', 30), pct('vignette', 'Vignette', 30), bool('verticalLines', 'Vertical Lines', false)
    ]
  },
  {
    type: 'glow', name: 'Glow', group: 'Stylize', kind: 'video',
    params: [px('distance', 'Distance', 10, 0, 100), num('outerStrength', 'Outer Strength', 4, 0, 20, { step: 0.1 }), num('innerStrength', 'Inner Strength', 0, 0, 20, { step: 0.1 }), color('color', 'Color', '#ffffff')]
  },
  {
    type: 'bloom', name: 'Bloom', group: 'Stylize', kind: 'video',
    params: [pct('threshold', 'Threshold', 50), num('intensity', 'Intensity', 1, 0, 3, { step: 0.05 }), num('brightness', 'Brightness', 1, 0, 3, { step: 0.05 }), px('blur', 'Blur', 8, 0, 50)]
  },
  {
    type: 'drop-shadow', name: 'Drop Shadow', group: 'Stylize', kind: 'video',
    params: [point('offset', 'Offset', [4, 4]), px('blur', 'Blur', 4, 0, 50), color('color', 'Color', '#000000'), pct('opacity', 'Opacity', 60)]
  },
  {
    type: 'outline', name: 'Outline', group: 'Stylize', kind: 'video',
    params: [px('thickness', 'Thickness', 2, 0, 50), color('color', 'Color', '#ffffff'), pct('opacity', 'Opacity', 100)]
  },
  {
    type: 'ascii', name: 'ASCII', group: 'Stylize', kind: 'video',
    params: [px('size', 'Character Size', 8, 2, 40), color('color', 'Color', '#ffffff'), bool('replaceColor', 'Single Color', false)]
  },
  { type: 'mosaic', name: 'Mosaic', group: 'Stylize', kind: 'video', params: [px('width', 'Cell Width', 16, 1, 300), px('height', 'Cell Height', 16, 1, 300)] }
];

const distort: EffectDef[] = [
  {
    type: 'twist', name: 'Twist', group: 'Distort', kind: 'video',
    params: [angle('angle', 'Angle', 90, -720, 720), px('radius', 'Radius', 300, 0, 4000), centerPoint()]
  },
  {
    type: 'bulge-pinch', name: 'Bulge/Pinch', group: 'Distort', kind: 'video',
    params: [num('strength', 'Strength', 50, -100, 100), px('radius', 'Radius', 300, 0, 4000), centerPoint()]
  },
  {
    type: 'shockwave', name: 'Shockwave', group: 'Distort', kind: 'video',
    params: [
      centerPoint(), num('startTime', 'Start Time', 0, 0, 3600, { step: 0.01, unit: 's', animatable: false }),
      px('speed', 'Speed', 500, 1, 4000), px('amplitude', 'Amplitude', 30, 0, 200), px('wavelength', 'Wavelength', 160, 1, 1000),
      num('brightness', 'Brightness', 1, 0, 3, { step: 0.05 }), px('radius', 'Max Radius', 0, 0, 8000)
    ],
    description: 'Max radius 0 lets the wave run forever'
  },
  {
    type: 'reflection', name: 'Reflection', group: 'Distort', kind: 'video',
    params: [
      pct('boundary', 'Water Line', 50), bool('mirror', 'Mirror', true), px('amplitude', 'Amplitude', 20, 0, 100),
      px('wavelength', 'Wavelength', 60, 1, 400), num('speed', 'Speed', 1, 0, 10, { step: 0.1 }), pct('opacity', 'Reflection Opacity', 70)
    ]
  },
  { type: 'lens-distortion', name: 'Lens Distortion', group: 'Distort', kind: 'video', params: [num('amount', 'Amount', 20, -100, 100)] },
  {
    type: 'mirror', name: 'Mirror', group: 'Distort', kind: 'video',
    params: [
      select('axis', 'Axis', 'vertical', [
        { value: 'vertical', label: 'Left to Right' }, { value: 'vertical-reverse', label: 'Right to Left' },
        { value: 'horizontal', label: 'Top to Bottom' }, { value: 'horizontal-reverse', label: 'Bottom to Top' }
      ]),
      pct('center', 'Center', 50)
    ]
  }
];

const transform: EffectDef[] = [
  {
    type: 'crop', name: 'Crop', group: 'Transform', kind: 'video',
    params: [pct('left', 'Left', 0, 0, 100, { step: 0.1 }), pct('top', 'Top', 0, 0, 100, { step: 0.1 }), pct('right', 'Right', 0, 0, 100, { step: 0.1 }), pct('bottom', 'Bottom', 0, 0, 100, { step: 0.1 }), px('feather', 'Edge Feather', 0, 0, 500)]
  },
  { type: 'flip', name: 'Flip', group: 'Transform', kind: 'video', params: [bool('horizontal', 'Horizontal', true), bool('vertical', 'Vertical', false)] }
];

const generate: EffectDef[] = [
  { type: 'color-overlay', name: 'Color Overlay', group: 'Generate', kind: 'video', params: [color('color', 'Color', '#d19a66'), pct('opacity', 'Opacity', 50)] },
  {
    type: 'gradient-overlay', name: 'Gradient Overlay', group: 'Generate', kind: 'video',
    params: [
      select('shape', 'Shape', 'linear', [{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }]),
      angle('angle', 'Angle', 90, 0, 360), color('startColor', 'Start Color', '#000000'), color('endColor', 'End Color', '#ffffff'), pct('opacity', 'Opacity', 50)
    ]
  }
];

const audio: EffectDef[] = [
  { type: 'gain', name: 'Gain', group: 'Amplitude', kind: 'audio', params: [db('gain', 'Gain', 0, -60, 24)] },
  {
    type: 'equalizer', name: 'Equalizer', group: 'Filter & EQ', kind: 'audio',
    params: [
      db('low', 'Low (100 Hz)', 0, -24, 24), db('mid', 'Mid', 0, -24, 24), hz('midFrequency', 'Mid Frequency', 1000, 200, 8000),
      num('midQ', 'Mid Q', 1, 0.1, 10, { step: 0.1 }), db('high', 'High (8 kHz)', 0, -24, 24)
    ]
  },
  { type: 'low-pass', name: 'Low-pass', group: 'Filter & EQ', kind: 'audio', params: [hz('frequency', 'Cutoff', 4000, 20, 20000), num('q', 'Resonance', 1, 0.1, 20, { step: 0.1 })] },
  { type: 'high-pass', name: 'High-pass', group: 'Filter & EQ', kind: 'audio', params: [hz('frequency', 'Cutoff', 200, 20, 20000), num('q', 'Resonance', 1, 0.1, 20, { step: 0.1 })] },
  { type: 'band-pass', name: 'Band-pass', group: 'Filter & EQ', kind: 'audio', params: [hz('frequency', 'Center', 1000, 20, 20000), num('q', 'Width (Q)', 1, 0.1, 20, { step: 0.1 })] },
  {
    type: 'compressor', name: 'Compressor', group: 'Dynamics', kind: 'audio',
    params: [
      db('threshold', 'Threshold', -24, -100, 0), db('knee', 'Knee', 30, 0, 40), num('ratio', 'Ratio', 4, 1, 20, { step: 0.1, unit: ':1' }),
      num('attack', 'Attack', 3, 0, 1000, { unit: 'ms', step: 0.1 }), num('release', 'Release', 250, 0, 1000, { unit: 'ms' }), db('makeup', 'Makeup Gain', 0, 0, 24)
    ]
  },
  {
    type: 'reverb', name: 'Reverb', group: 'Reverb & Delay', kind: 'audio',
    params: [num('duration', 'Size', 2, 0.1, 10, { step: 0.1, unit: 's', animatable: false }), num('decay', 'Decay', 2, 0.1, 10, { step: 0.1, animatable: false }), pct('mix', 'Mix', 30)]
  },
  {
    type: 'delay', name: 'Delay/Echo', group: 'Reverb & Delay', kind: 'audio',
    params: [num('time', 'Delay', 250, 1, 5000, { unit: 'ms' }), pct('feedback', 'Feedback', 30, 0, 95), pct('mix', 'Mix', 30)]
  },
  { type: 'stereo-width', name: 'Stereo Width', group: 'Stereo', kind: 'audio', params: [pct('width', 'Width', 100, 0, 200)] },
  {
    type: 'mute-channel', name: 'Mute Channel', group: 'Stereo', kind: 'audio',
    params: [select('channel', 'Channel', 'left', [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }])]
  }
];

export const effectDefs: EffectDef[] = [
  ...fixedVideo, ...fixedAudio,
  ...blur, ...colorCorrection, ...keying, ...stylize, ...distort, ...transform, ...generate,
  ...audio
];

const byType = new Map(effectDefs.map((d) => [d.type, d]));

export function effectDef(type: string): EffectDef | undefined {
  return byType.get(type);
}

export function defaultParams(type: string): Record<string, ParamValue> {
  const def = byType.get(type);
  const out: Record<string, ParamValue> = {};
  if (!def) return out;
  for (const p of def.params) {
    // arrays must not be shared between instances, a drag on one point would move them all
    out[p.key] = Array.isArray(p.default) ? [p.default[0], p.default[1]] : p.default;
  }
  return out;
}

export function createEffectInstance(type: string): EffectInstance {
  const def = byType.get(type);
  if (!def) throw new Error(`Unknown effect type: ${type}`);
  return {
    id: id(),
    type,
    enabled: true,
    ...(def.kind === 'fixed' ? { fixed: true } : {}),
    params: defaultParams(type),
    keyframes: {}
  };
}

export const fixedVideoEffectTypes = fixedVideo.map((d) => d.type);
export const fixedAudioEffectTypes = fixedAudio.map((d) => d.type);

export function isFixedEffectType(type: string): boolean {
  return byType.get(type)?.kind === 'fixed';
}

// fixed effects belong to a clip kind too, the panel needs to know which
export function isVideoEffectType(type: string): boolean {
  const def = byType.get(type);
  return !!def && (def.kind === 'video' || fixedVideoEffectTypes.includes(type));
}

export function isAudioEffectType(type: string): boolean {
  const def = byType.get(type);
  return !!def && (def.kind === 'audio' || fixedAudioEffectTypes.includes(type));
}

export function effectsInGroup(group: string): EffectDef[] {
  return effectDefs.filter((d) => d.group === group && d.kind !== 'fixed');
}

export function paramDef(type: string, key: string): ParamDef | undefined {
  return byType.get(type)?.params.find((p) => p.key === key);
}

// the fade in / fade out helpers of the audio menu are nothing more than two
// keyframes on the volume level, so they live here as presets
export function fadeKeyframes(direction: 'in' | 'out', clipDuration: number, seconds = 1): Keyframe[] {
  const length = Math.min(seconds, clipDuration);
  if (direction === 'in') {
    return [
      { time: 0, value: -60, easing: 'ease-out' },
      { time: length, value: 0, easing: 'linear' }
    ];
  }
  return [
    { time: clipDuration - length, value: 0, easing: 'ease-in' },
    { time: clipDuration, value: -60, easing: 'linear' }
  ];
}
