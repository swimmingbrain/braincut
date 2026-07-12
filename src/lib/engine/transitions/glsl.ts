// turns a gl-transition (glsl es 1.00, expecting the host to define
// getFromColor, getToColor, progress and ratio) into a fragment shader for a
// pixi v8 filter. pure strings, so this can be tested without a gpu

// pixi keeps texture y pointing down while gl-transitions were written for
// y up, so the uv handed to the transition and the lookups both flip. this
// keeps "wipe up" going up
export const transitionHeader = `precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uFromTexture;
uniform sampler2D uToTexture;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform float progress;
uniform float ratio;

vec4 getFromColor(vec2 uv) {
  return texture(uFromTexture, vec2(uv.x, 1.0 - uv.y));
}
vec4 getToColor(vec2 uv) {
  return texture(uToTexture, vec2(uv.x, 1.0 - uv.y));
}
`;

export const transitionFooter = `
void main() {
  vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
  finalColor = transition(vec2(uv.x, 1.0 - uv.y));
}
`;

// a few transitions need a hand before they compile as glsl 3.00
const patches: Record<string, (glsl: string) => string> = {
  // defines its own texture() helper, which is a builtin now
  FilmBurn: (glsl) => glsl.replace(/\btexture\s*\(/g, 'burnTexture(')
};

export function rewriteTransitionGlsl(glslId: string, glsl: string): string {
  let out = patches[glslId] ? patches[glslId](glsl) : glsl;
  // the header sets the precision, a second statement mid-file is an error
  out = out.replace(/^\s*precision\s+\w+\s+float\s*;\s*$/gm, '');
  // line comments go too, a few keep old gl_FragColor lines around
  out = out.replace(/\/\/.*$/gm, '');
  out = out.replace(/\btexture2D\s*\(/g, 'texture(');
  return out;
}

export function buildTransitionFragment(glslId: string, glsl: string): string {
  return transitionHeader + rewriteTransitionGlsl(glslId, glsl) + transitionFooter;
}

export type GlParamType = 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'ivec2' | 'sampler2D';
export type PixiUniformType = 'f32' | 'i32' | 'vec2<f32>' | 'vec3<f32>' | 'vec4<f32>' | 'vec2<i32>';

// bool goes through as an int, gl accepts uniform1i for bool uniforms
export function uniformTypeFor(type: GlParamType): PixiUniformType | null {
  switch (type) {
    case 'float': return 'f32';
    case 'int': return 'i32';
    case 'bool': return 'i32';
    case 'vec2': return 'vec2<f32>';
    case 'vec3': return 'vec3<f32>';
    case 'vec4': return 'vec4<f32>';
    case 'ivec2': return 'vec2<i32>';
    default: return null;
  }
}
