import { Filter, GlProgram, defaultFilterVert } from 'pixi.js';

// what every custom fragment starts with. pixi hands the filter its input as
// uTexture and describes the frame through these vec4s (size, 1/size for
// uInputSize; x, y, w, h for uOutputFrame; the sample clamp for uInputClamp)
export const fragmentHeader = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;

// 0..1 across the filtered area, whatever size pixi picked for the texture
vec2 frameUv() {
  return vTextureCoord * uInputSize.xy / uOutputFrame.zw;
}
vec2 frameToTex(vec2 uv) {
  return clamp(uv * uOutputFrame.zw * uInputSize.zw, uInputClamp.xy, uInputClamp.zw);
}
float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
`;

interface ScalarUniform { value: number; type: 'f32' }
interface VectorUniform { value: Float32Array; type: 'vec2<f32>' | 'vec3<f32>' | 'vec4<f32>' }
export type UniformSpec = Record<string, ScalarUniform | VectorUniform>;


export class ShaderFilter<V extends Record<string, number | Float32Array>> extends Filter {
  readonly uniforms: V;

  constructor(name: string, fragment: string, uniforms: UniformSpec) {
    super({
      glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment: fragmentHeader + fragment, name }),
      resources: { effectUniforms: uniforms }
    });
    this.uniforms = this.resources.effectUniforms.uniforms as V;
  }
}

export function f32(value: number): ScalarUniform {
  return { value, type: 'f32' };
}
export function vec2(x: number, y: number): VectorUniform {
  return { value: new Float32Array([x, y]), type: 'vec2<f32>' };
}
export function vec3(x: number, y: number, z: number): VectorUniform {
  return { value: new Float32Array([x, y, z]), type: 'vec3<f32>' };
}
export function vec4(x: number, y: number, z: number, w: number): VectorUniform {
  return { value: new Float32Array([x, y, z, w]), type: 'vec4<f32>' };
}

export function setVec(target: Float32Array, ...values: number[]): void {
  for (let i = 0; i < values.length; i++) target[i] = values[i];
}
