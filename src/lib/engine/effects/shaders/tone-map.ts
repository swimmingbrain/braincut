import { ShaderFilter, f32 } from './common';

// hdr pictures reach the canvas as they came out of the decoder: pq or hlg
// coded, bt.2020 primaries. the browser hands them over without converting,
// so the same numbers read as srgb look hazy and washed out. this undoes the
// transfer curve, compresses the highlights and lands in srgb/bt.709.
// uMode 0 = pq (smpte 2084), 1 = hlg (arib b67)
const fragment = `
uniform float uMode;

const float PQ_M1 = 0.1593017578125;
const float PQ_M2 = 78.84375;
const float PQ_C1 = 0.8359375;
const float PQ_C2 = 18.8515625;
const float PQ_C3 = 18.6875;

// 1.0 comes out as diffuse white, the reference the sdr picture is built on
const float PQ_WHITE = 10000.0 / 203.0;

vec3 pqToLinear(vec3 v) {
  vec3 p = pow(max(v, 0.0), vec3(1.0 / PQ_M2));
  vec3 num = max(p - PQ_C1, 0.0);
  vec3 den = max(PQ_C2 - PQ_C3 * p, 1e-6);
  return pow(num / den, vec3(1.0 / PQ_M1)) * PQ_WHITE;
}

vec3 hlgToLinear(vec3 v) {
  const float a = 0.17883277;
  const float b = 0.28466892;
  const float c = 0.55991073;
  vec3 lo = v * v / 3.0;
  vec3 hi = (exp((v - c) / a) + b) / 12.0;
  vec3 e = mix(lo, hi, step(0.5, v));
  // the display side of hlg, a mild gamma on the luminance
  float y = max(dot(e, vec3(0.2627, 0.6780, 0.0593)), 1e-6);
  return e * pow(y, 0.2) * 4.0;
}

// reinhard with a shoulder, so a 1000 nit highlight still separates
vec3 compress(vec3 c) {
  const float peak = 10.0;
  return c * (1.0 + c / (peak * peak)) / (1.0 + c);
}

vec3 bt2020ToBt709(vec3 c) {
  return vec3(
    dot(c, vec3(1.66049, -0.58764, -0.07285)),
    dot(c, vec3(-0.12455, 1.13290, -0.00835)),
    dot(c, vec3(-0.01825, -0.10058, 1.11883))
  );
}

vec3 srgbEncode(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, 1e-6), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(0.0031308, c));
}

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  vec3 lin = uMode < 0.5 ? pqToLinear(src.rgb) : hlgToLinear(src.rgb);
  vec3 out709 = clamp(bt2020ToBt709(compress(lin)), 0.0, 1.0);
  finalColor = vec4(srgbEncode(out709) * src.a, src.a);
}
`;

export class ToneMapFilter extends ShaderFilter<{ uMode: number }> {
  constructor(mode: 'pq' | 'hlg') {
    super(`tone-map-${mode}`, fragment, { uMode: f32(mode === 'hlg' ? 1 : 0) });
  }
}

// what the decoder calls the transfer function of an hdr picture
export function toneMapMode(transfer: string | null | undefined): 'pq' | 'hlg' | null {
  if (!transfer) return null;
  const t = transfer.toLowerCase();
  if (t === 'pq' || t === 'smpte2084' || t === 'smpte-st-2084') return 'pq';
  if (t === 'hlg' || t === 'arib-std-b67' || t === 'aribstdb67') return 'hlg';
  return null;
}
