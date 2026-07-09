import { ShaderFilter, f32 } from './common';

const fragment = `
uniform float uInputBlack;
uniform float uInputWhite;
uniform float uGamma;
uniform float uOutputBlack;
uniform float uOutputWhite;

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a <= 0.0) { finalColor = src; return; }
  vec3 c = src.rgb / src.a;
  c = clamp((c - uInputBlack) / max(uInputWhite - uInputBlack, 0.001), 0.0, 1.0);
  c = pow(c, vec3(1.0 / uGamma));
  c = uOutputBlack + c * (uOutputWhite - uOutputBlack);
  finalColor = vec4(clamp(c, 0.0, 1.0) * src.a, src.a);
}
`;

export class LevelsFilter extends ShaderFilter<{
  uInputBlack: number; uInputWhite: number; uGamma: number;
  uOutputBlack: number; uOutputWhite: number;
}> {
  constructor() {
    super('levels', fragment, { uInputBlack: f32(0), uInputWhite: f32(1), uGamma: f32(1), uOutputBlack: f32(0), uOutputWhite: f32(1) });
  }
}
