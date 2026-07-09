import { ShaderFilter, f32, vec3 } from './common';

// roundness -1 follows the frame's aspect (a rounded rectangle-ish oval),
// 0 is an ellipse that fits the frame, 1 is a circle
const fragment = `
uniform float uAmount;
uniform float uMidpoint;
uniform float uRoundness;
uniform float uFeather;
uniform vec3 uColor;

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  vec2 uv = frameUv() - 0.5;
  float aspect = uOutputFrame.z / uOutputFrame.w;
  vec2 circle = uv * vec2(aspect, 1.0);
  vec2 ellipse = uv;
  vec2 p = mix(ellipse, circle, clamp(uRoundness, 0.0, 1.0));
  float d;
  if (uRoundness < 0.0) {
    // superellipse, the corners get squarer the further down you go
    float n = mix(2.0, 8.0, -uRoundness);
    d = pow(pow(abs(p.x * 2.0), n) + pow(abs(p.y * 2.0), n), 1.0 / n) * 0.5;
  } else {
    d = length(p);
  }
  float inner = uMidpoint * 0.75;
  float outer = inner + max(uFeather, 0.001) * 0.75;
  float v = smoothstep(inner, outer, d) * uAmount;
  finalColor = vec4(mix(src.rgb, uColor * src.a, v), src.a);
}
`;

export class VignetteFilter extends ShaderFilter<{
  uAmount: number; uMidpoint: number; uRoundness: number;
  uFeather: number; uColor: Float32Array;
}> {
  constructor() {
    super('vignette', fragment, { uAmount: f32(0.5), uMidpoint: f32(0.5), uRoundness: f32(0), uFeather: f32(0.5), uColor: vec3(0, 0, 0) });
  }
}
