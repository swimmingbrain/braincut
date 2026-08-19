// turns a gl-transition (glsl es 1.00, expecting the host to define
// getFromColor, getToColor, progress and ratio) into a fragment shader for a
// pixi v8 filter. pure strings, so this can be tested without a gpu

// pixi keeps texture y pointing down while gl-transitions were written for
// y up, so the uv handed to the transition and the lookups both flip. this
// keeps "wipe up" going up
// the version line matters: without it pixi treats the source as glsl es 1.00
// and defines `in` to `varying`, which breaks every transition that takes an
// `in` qualified function parameter
export const transitionHeader = `#version 300 es
precision highp float;
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

// glsl es 1.00 let a global be initialised from a uniform, 3.00 wants a
// constant there. the few transitions that do it get the expression moved
// into a function and the name defined to a call, so their bodies read the same
const GLOBAL_INIT = /^\s*(float|int|uint|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|bvec2|bvec3|bvec4|mat2|mat3|mat4)\s+([A-Za-z_]\w*)\s*=\s*(.+);\s*$/;
const DECLARATION = /^\s*(?:const|uniform|in|out|attribute|varying)\b/;

export function liftGlobalInitializers(glsl: string): string {
  const lines = glsl.split('\n');
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (depth === 0 && !DECLARATION.test(line)) {
      const m = GLOBAL_INIT.exec(line);
      if (m) lines[i] = `${m[1]} ${m[2]}_lifted() { return ${m[3]}; }\n#define ${m[2]} ${m[2]}_lifted()`;
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
  }
  return lines.join('\n');
}

export function rewriteTransitionGlsl(glslId: string, glsl: string): string {
  let out = patches[glslId] ? patches[glslId](glsl) : glsl;
  // the header sets the precision, a second statement mid-file is an error
  out = out.replace(/^\s*precision\s+\w+\s+float\s*;\s*$/gm, '');
  // line comments go too, a few keep old gl_FragColor lines around
  out = out.replace(/\/\/.*$/gm, '');
  out = out.replace(/\btexture2D\s*\(/g, 'texture(');
  out = liftGlobalInitializers(out);
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
