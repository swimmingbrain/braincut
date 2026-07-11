// a pixi filter around one gl-transition. the compositor renders the two
// clips into textures of the sequence size, hands them over with
// setInputs, drives progress and draws a full-frame sprite with this filter
import { Filter, GlProgram, Texture, defaultFilterVert } from 'pixi.js';
import type { UniformData } from 'pixi.js';
import type { ParamValue } from '$lib/project/types';
import { hexToRgb } from '../effects/filters';
import { buildTransitionFragment, uniformTypeFor } from './glsl';
import type { GlParamType } from './glsl';
import { glTransition, transitionDef } from './registry';
import type { TransitionDef } from './registry';

type GlDefault = number | boolean | number[];

function initialValue(type: GlParamType, def: GlDefault | undefined): number | Float32Array | Int32Array {
  const list = Array.isArray(def) ? def : [];
  switch (type) {
    case 'float': return typeof def === 'number' ? def : 0;
    case 'int': return typeof def === 'number' ? def : 0;
    case 'bool': return def ? 1 : 0;
    case 'vec2': return new Float32Array([list[0] ?? 0, list[1] ?? 0]);
    case 'ivec2': return new Int32Array([list[0] ?? 0, list[1] ?? 0]);
    case 'vec3': return new Float32Array([list[0] ?? 0, list[1] ?? 0, list[2] ?? 0]);
    case 'vec4': return new Float32Array([list[0] ?? 0, list[1] ?? 0, list[2] ?? 0, list[3] ?? 1]);
    default: return 0;
  }
}

export class TransitionFilter extends Filter {
  readonly def: TransitionDef;
  private readonly glTypes: Record<string, GlParamType>;
  private readonly uniforms: Record<string, number | Float32Array | Int32Array>;

  constructor(def: TransitionDef) {
    const gl = def.glslId ? glTransition(def.glslId) : undefined;
    if (!gl) throw new Error(`Transition ${def.id} has no shader`);

    const uniforms: Record<string, UniformData> = {
      progress: { value: 0, type: 'f32' },
      ratio: { value: 1, type: 'f32' }
    };
    const glTypes: Record<string, GlParamType> = {};
    for (const [key, type] of Object.entries(gl.paramsTypes)) {
      const uniformType = uniformTypeFor(type);
      if (!uniformType) continue;
      glTypes[key] = type;
      uniforms[key] = { value: initialValue(type, gl.defaultParams[key]), type: uniformType };
    }

    const empty = Texture.EMPTY.source;
    super({
      glProgram: GlProgram.from({
        vertex: defaultFilterVert,
        fragment: buildTransitionFragment(gl.name, gl.glsl),
        name: `transition-${def.id}`
      }),
      resources: {
        transitionUniforms: uniforms,
        uFromTexture: empty,
        uFromSampler: empty.style,
        uToTexture: empty,
        uToSampler: empty.style
      }
    });
    this.def = def;
    this.glTypes = glTypes;
    this.uniforms = this.resources.transitionUniforms.uniforms;
    this.setParams(def.defaultParams);
  }

  setInputs(from: Texture, to: Texture): void {
    this.resources.uFromTexture = from.source;
    this.resources.uFromSampler = from.source.style;
    this.resources.uToTexture = to.source;
    this.resources.uToSampler = to.source.style;
  }

  set progress(v: number) {
    this.uniforms.progress = Math.min(1, Math.max(0, v));
  }

  get progress(): number {
    return this.uniforms.progress as number;
  }

  set ratio(v: number) {
    this.uniforms.ratio = v;
  }

  get ratio(): number {
    return this.uniforms.ratio as number;
  }

  // params the registry does not expose keep the gl default they got in
  // the constructor, everything else is converted from the project's units
  setParams(params: Record<string, ParamValue>): void {
    for (const [key, type] of Object.entries(this.glTypes)) {
      const value = params[key] ?? this.def.defaultParams[key];
      if (value === undefined) continue;
      const current = this.uniforms[key];
      switch (type) {
        case 'float':
        case 'int':
          if (typeof value === 'number') this.uniforms[key] = type === 'int' ? Math.round(value) : value;
          break;
        case 'bool':
          this.uniforms[key] = value ? 1 : 0;
          break;
        case 'vec2':
        case 'ivec2':
          if (Array.isArray(value) && typeof current === 'object') {
            current[0] = value[0];
            current[1] = value[1];
          }
          break;
        case 'vec3':
        case 'vec4':
          if (typeof value === 'string' && typeof current === 'object') {
            const [r, g, b] = hexToRgb(value);
            current[0] = r;
            current[1] = g;
            current[2] = b;
          }
          break;
      }
    }
  }
}

// always a fresh instance, the compositor keeps one per transition in use
export function createTransitionFilter(id: string): TransitionFilter | null {
  const def = transitionDef(id);
  if (!def || def.kind !== 'video') return null;
  return new TransitionFilter(def);
}
