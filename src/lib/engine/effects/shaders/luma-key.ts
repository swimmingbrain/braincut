import { ShaderFilter, f32 } from './common';

const fragment = `
uniform float uThreshold;
uniform float uSoftness;
uniform float uInvert;

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a <= 0.0) { finalColor = src; return; }
  float l = luma(src.rgb / src.a);
  float a = smoothstep(uThreshold - uSoftness, uThreshold + uSoftness + 0.001, l);
  a = mix(a, 1.0 - a, uInvert);
  finalColor = src * a;
}
`;

export class LumaKeyFilter extends ShaderFilter<{
  uThreshold: number; uSoftness: number; uInvert: number;
}> {
  constructor() {
    super('luma-key', fragment, { uThreshold: f32(0.2), uSoftness: f32(0.1), uInvert: f32(0) });
  }
}
