import { describe, expect, it } from 'vitest';
import transitions from 'gl-transitions';
import { buildTransitionFragment, liftGlobalInitializers, rewriteTransitionGlsl, uniformTypeFor } from './glsl';
import { glTransition, transitionDefs } from './registry';

function glslOf(id: string): string {
  const t = transitions.find((x) => x.name === id);
  if (!t) throw new Error(`no gl-transition ${id}`);
  return t.glsl;
}

describe('transition glsl rewrite', () => {
  it('produces a complete es 3.00 fragment', () => {
    const src = buildTransitionFragment('fade', glslOf('fade'));
    expect(src.split('\n')[0]).toBe('#version 300 es');
    expect(src).toContain('precision highp float;');
    expect(src).toContain('in vec2 vTextureCoord;');
    expect(src).toContain('out vec4 finalColor;');
    expect(src).toContain('uniform sampler2D uFromTexture;');
    expect(src).toContain('uniform sampler2D uToTexture;');
    expect(src).toContain('uniform float progress;');
    expect(src).toContain('uniform float ratio;');
    expect(src).toContain('vec4 getFromColor(vec2 uv)');
    expect(src).toContain('vec4 getToColor(vec2 uv)');
    expect(src).toContain('vec4 transition');
    expect(src).toContain('finalColor = transition(');
    expect(src.match(/void main\s*\(/g)?.length).toBe(1);
  });

  it('drops legacy syntax from every curated transition', () => {
    for (const def of transitionDefs) {
      if (!def.glslId) continue;
      const src = buildTransitionFragment(def.glslId, glslOf(def.glslId));
      expect(src, def.id).not.toMatch(/texture2D/);
      expect(src, def.id).not.toMatch(/gl_FragColor/);
      expect(src, def.id).not.toMatch(/\bvarying\b/);
      expect(src.match(/precision\s+\w+\s+float\s*;/g)?.length, def.id).toBe(1);
      // a user function called texture() would shadow the builtin our lookups use
      expect(src, def.id).not.toMatch(/^\s*(?:vec4|vec3|float)\s+texture\s*\(/m);
      // every uniform the transition declares must be one we can feed
      for (const [key, type] of Object.entries(glTransition(def.glslId)?.paramsTypes ?? {})) {
        expect(uniformTypeFor(type), `${def.id}.${key}`).not.toBeNull();
      }
    }
  });

  it('keeps the transition body otherwise untouched', () => {
    const glsl = 'precision mediump float;\nvec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }';
    expect(rewriteTransitionGlsl('x', glsl).trim()).toBe('vec4 transition(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }');
    expect(rewriteTransitionGlsl('x', 'texture2D(luma, uv)')).toBe('texture(luma, uv)');
  });
});

describe('global initializers', () => {
  it('moves a global that reads a uniform into a function', () => {
    const out = liftGlobalInitializers('uniform float q;\nfloat n = clamp(q, 0.2, 1.0);\nvec4 transition(vec2 uv) { return vec4(n); }');
    expect(out).toContain('float n_lifted() { return clamp(q, 0.2, 1.0); }');
    expect(out).toContain('#define n n_lifted()');
    expect(out).not.toMatch(/^float n = /m);
  });

  it('leaves declarations and locals alone', () => {
    const src = 'const float K = 0.5;\nuniform vec2 dir;\nvec4 transition(vec2 uv) {\nfloat d = uv.x;\nreturn vec4(d * K);\n}';
    expect(liftGlobalInitializers(src)).toBe(src);
  });

  it('leaves no top level initializer in any curated transition', () => {
    for (const def of transitionDefs) {
      if (!def.glslId) continue;
      const src = buildTransitionFragment(def.glslId, glslOf(def.glslId));
      let depth = 0;
      for (const line of src.split('\n')) {
        if (depth === 0 && !/^\s*(?:const|uniform|in|out)\b/.test(line)) {
          expect(line, `${def.id}: ${line}`).not.toMatch(/^\s*(?:float|int|vec2|vec3|vec4|ivec2|mat2|mat3|mat4)\s+\w+\s*=/);
        }
        for (const ch of line) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
      }
    }
  });
});
