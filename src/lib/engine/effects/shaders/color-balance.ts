import { ShaderFilter, f32, vec3 } from './common';

// three-way color balance: each range gets its own rgb offset, weighted by
// how much the pixel belongs to shadows, midtones or highlights
const fragment = `
uniform vec3 uShadows;
uniform vec3 uMidtones;
uniform vec3 uHighlights;
uniform float uPreserveLuma;

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a <= 0.0) { finalColor = src; return; }
  vec3 c = src.rgb / src.a;
  float l = luma(c);
  float shadowW = 1.0 - smoothstep(0.0, 0.5, l);
  float highW = smoothstep(0.5, 1.0, l);
  float midW = 1.0 - shadowW - highW;
  vec3 adjusted = c + uShadows * shadowW * 0.5 + uMidtones * midW * 0.5 + uHighlights * highW * 0.5;
  adjusted = clamp(adjusted, 0.0, 1.0);
  if (uPreserveLuma > 0.5) {
    float nl = luma(adjusted);
    adjusted = clamp(adjusted + (l - nl), 0.0, 1.0);
  }
  finalColor = vec4(adjusted * src.a, src.a);
}
`;

export class ColorBalanceFilter extends ShaderFilter<{
  uShadows: Float32Array; uMidtones: Float32Array; uHighlights: Float32Array; uPreserveLuma: number;
}> {
  constructor() {
    super('color-balance', fragment, { uShadows: vec3(0, 0, 0), uMidtones: vec3(0, 0, 0), uHighlights: vec3(0, 0, 0), uPreserveLuma: f32(1) });
  }
}
