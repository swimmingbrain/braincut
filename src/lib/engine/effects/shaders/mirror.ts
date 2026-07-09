import { ShaderFilter, f32 } from './common';

// axis: 0 left half onto right, 1 right onto left, 2 top onto bottom, 3 bottom onto top
const fragment = `
uniform float uAxis;
uniform float uCenter;

void main() {
  vec2 uv = frameUv();
  if (uAxis < 0.5) {
    if (uv.x > uCenter) uv.x = 2.0 * uCenter - uv.x;
  } else if (uAxis < 1.5) {
    if (uv.x < uCenter) uv.x = 2.0 * uCenter - uv.x;
  } else if (uAxis < 2.5) {
    if (uv.y > uCenter) uv.y = 2.0 * uCenter - uv.y;
  } else {
    if (uv.y < uCenter) uv.y = 2.0 * uCenter - uv.y;
  }
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    finalColor = vec4(0.0);
    return;
  }
  finalColor = texture(uTexture, frameToTex(uv));
}
`;

export class MirrorFilter extends ShaderFilter<{ uAxis: number; uCenter: number }> {
  constructor() {
    super('mirror', fragment, { uAxis: f32(0), uCenter: f32(0.5) });
  }
}
