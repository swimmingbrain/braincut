import { ShaderFilter, f32, vec3 } from './common';

// keys on chroma distance in ycbcr, which ignores brightness and so keeps
// the shadows people cast on a green screen. the feather taps the alpha of
// the neighbours, cheap and good enough for a preview and most exports
const fragment = `
uniform vec3 uKeyColor;
uniform float uTolerance;
uniform float uSoftness;
uniform float uSpill;
uniform float uEdgeThin;
uniform float uFeather;

vec2 chroma(vec3 c) {
  return vec2(
    -0.1146 * c.r - 0.3854 * c.g + 0.5 * c.b,
    0.5 * c.r - 0.4542 * c.g - 0.0458 * c.b
  );
}

float keyAlpha(vec3 c) {
  float d = distance(chroma(c), chroma(uKeyColor));
  float a = smoothstep(uTolerance, uTolerance + uSoftness + 0.001, d);
  // edge thin shifts the matte in or out before it gets clamped
  a = clamp(a + uEdgeThin * (a - 0.5) * 2.0 * step(0.001, a) * step(a, 0.999), 0.0, 1.0);
  return a;
}

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a <= 0.0) { finalColor = src; return; }
  vec3 c = src.rgb / src.a;
  float a = keyAlpha(c);

  if (uFeather > 0.0) {
    vec2 px = uInputSize.zw * uFeather;
    float sum = a;
    sum += keyAlpha(texture(uTexture, clamp(vTextureCoord + vec2(px.x, 0.0), uInputClamp.xy, uInputClamp.zw)).rgb);
    sum += keyAlpha(texture(uTexture, clamp(vTextureCoord - vec2(px.x, 0.0), uInputClamp.xy, uInputClamp.zw)).rgb);
    sum += keyAlpha(texture(uTexture, clamp(vTextureCoord + vec2(0.0, px.y), uInputClamp.xy, uInputClamp.zw)).rgb);
    sum += keyAlpha(texture(uTexture, clamp(vTextureCoord - vec2(0.0, px.y), uInputClamp.xy, uInputClamp.zw)).rgb);
    a = sum / 5.0;
  }

  // spill: pull the key hue back towards the other two channels
  vec3 k = uKeyColor;
  float dominant = k.g >= max(k.r, k.b) ? 1.0 : 0.0;
  if (dominant > 0.5) {
    float limit = mix(c.g, (c.r + c.b) * 0.5, uSpill);
    c.g = min(c.g, max(limit, min(c.r, c.b)));
  } else if (k.b >= k.r) {
    float limit = mix(c.b, (c.r + c.g) * 0.5, uSpill);
    c.b = min(c.b, max(limit, min(c.r, c.g)));
  } else {
    float limit = mix(c.r, (c.g + c.b) * 0.5, uSpill);
    c.r = min(c.r, max(limit, min(c.g, c.b)));
  }

  float outA = src.a * a;
  finalColor = vec4(c * outA, outA);
}
`;

export class ChromaKeyFilter extends ShaderFilter<{
  uKeyColor: Float32Array; uTolerance: number; uSoftness: number;
  uSpill: number; uEdgeThin: number; uFeather: number;
}> {
  constructor() {
    super('chroma-key', fragment, {
      uKeyColor: vec3(0, 1, 0), uTolerance: f32(0.25), uSoftness: f32(0.1), uSpill: f32(0.5), uEdgeThin: f32(0), uFeather: f32(0)
    });
  }
}
