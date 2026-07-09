import { ShaderFilter, f32 } from './common';

// the basic panel of a color page: exposure, tone, white balance and
// saturation. the math happens in a rough linear space (gamma 2.2) so
// exposure behaves like stops and highlights roll off instead of clipping
const fragment = `
uniform float uExposure;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uTemperature;
uniform float uTint;
uniform float uSaturation;
uniform float uVibrance;

vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toGamma(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a <= 0.0) { finalColor = src; return; }
  vec3 c = toLinear(src.rgb / src.a);

  c *= exp2(uExposure);

  // white balance as channel gains, warm pushes red up and blue down
  c.r *= 1.0 + uTemperature * 0.25;
  c.b *= 1.0 - uTemperature * 0.25;
  c.g *= 1.0 - uTint * 0.2;
  c.rb *= 1.0 + uTint * 0.08;

  float l = luma(c);
  float shadowW = 1.0 - smoothstep(0.0, 0.45, l);
  float highW = smoothstep(0.35, 1.0, l);
  c *= 1.0 + uShadows * 0.6 * shadowW;
  c *= 1.0 + uHighlights * 0.6 * highW;

  float whiteW = smoothstep(0.6, 1.0, l);
  float blackW = 1.0 - smoothstep(0.0, 0.2, l);
  c = c * (1.0 + uWhites * 0.4 * whiteW) + uBlacks * 0.08 * blackW;

  c = toGamma(c);

  c = (c - 0.5) * (1.0 + uContrast) + 0.5;

  float gray = luma(c);
  float maxc = max(c.r, max(c.g, c.b));
  float minc = min(c.r, min(c.g, c.b));
  float sat = maxc - minc;
  // vibrance pushes the dull pixels more than the ones already saturated
  c = mix(vec3(gray), c, 1.0 + uSaturation + uVibrance * (1.0 - sat));

  c = clamp(c, 0.0, 1.0);
  finalColor = vec4(c * src.a, src.a);
}
`;

export class ColorCorrectionFilter extends ShaderFilter<{
  uExposure: number; uContrast: number; uHighlights: number;
  uShadows: number; uWhites: number; uBlacks: number;
  uTemperature: number; uTint: number; uSaturation: number;
  uVibrance: number;
}> {
  constructor() {
    super('color-correction', fragment, {
      uExposure: f32(0), uContrast: f32(0), uHighlights: f32(0), uShadows: f32(0), uWhites: f32(0), uBlacks: f32(0),
      uTemperature: f32(0), uTint: f32(0), uSaturation: f32(0), uVibrance: f32(0)
    });
  }
}
