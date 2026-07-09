import { ShaderFilter, f32 } from './common';

const fragment = `
uniform float uLevels;

void main() {
  vec4 src = texture(uTexture, vTextureCoord);
  if (src.a <= 0.0) { finalColor = src; return; }
  vec3 c = src.rgb / src.a;
  float steps = max(uLevels - 1.0, 1.0);
  c = floor(c * steps + 0.5) / steps;
  finalColor = vec4(c * src.a, src.a);
}
`;

export class PosterizeFilter extends ShaderFilter<{ uLevels: number }> {
  constructor() {
    super('posterize', fragment, { uLevels: f32(6) });
  }
}
