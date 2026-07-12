import { describe, expect, it } from 'vitest';
import transitions from 'gl-transitions';
import { createTransition, glTransition, transitionCurve, transitionDef, transitionDefs, transitionGroups } from './registry';

describe('transition registry', () => {
  it('has unique ids and names', () => {
    const ids = transitionDefs.map((d) => d.id);
    const names = transitionDefs.map((d) => d.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('points every video transition at an existing gl-transition', () => {
    const known = new Set(transitions.map((t) => t.name));
    for (const def of transitionDefs) {
      if (def.kind === 'audio') {
        expect(def.glslId, def.id).toBeUndefined();
        continue;
      }
      expect(def.glslId, def.id).toBeDefined();
      expect(known.has(def.glslId as string), def.id).toBe(true);
      expect(glTransition(def.glslId as string)).toBeDefined();
    }
  });

  it('uses the documented groups and has the audio trio', () => {
    for (const def of transitionDefs) expect(transitionGroups, def.id).toContain(def.group);
    expect(transitionDef('crossfade')?.kind).toBe('audio');
    expect(transitionDef('constant-gain')?.kind).toBe('audio');
    expect(transitionDef('exponential-fade')?.kind).toBe('audio');
  });

  it('gives every exposed param a default of the right shape', () => {
    for (const def of transitionDefs) {
      for (const p of def.params) {
        const label = `${def.id}.${p.key}`;
        expect(def.defaultParams[p.key], label).toEqual(p.default);
        if (p.kind === 'number') {
          expect(p.default as number, label).toBeGreaterThanOrEqual(p.min as number);
          expect(p.default as number, label).toBeLessThanOrEqual(p.max as number);
        }
        if (p.kind === 'color') expect(p.default, label).toMatch(/^#[0-9a-f]{6}$/);
        if (p.kind === 'point') expect(Array.isArray(p.default) && p.default.length === 2, label).toBe(true);
      }
    }
  });

  it('has four pushes sharing the Directional shader', () => {
    const pushes = transitionDefs.filter((d) => d.glslId === 'Directional');
    expect(pushes.map((d) => d.id).sort()).toEqual(['push-down', 'push-left', 'push-right', 'push-up']);
    const dirs = new Set(pushes.map((d) => JSON.stringify(d.defaultParams.direction)));
    expect(dirs.size).toBe(4);
    expect(transitionDef('dip-to-white')?.defaultParams.color).toBe('#ffffff');
    expect(transitionDef('dip-to-black')?.defaultParams.color).toBe('#000000');
  });

  it('creates transitions with copied defaults', () => {
    const t = createTransition('push-left', 'a', 'b', 10, 1);
    expect(t.type).toBe('push-left');
    expect(t.params.direction).toEqual([1, 0]);
    expect(t.params.direction).not.toBe(transitionDef('push-left')?.defaultParams.direction);
    expect(() => createTransition('nope', null, null, 0, 1)).toThrow();
  });

  it('curves start and end at unity', () => {
    for (const type of ['crossfade', 'constant-gain', 'exponential-fade', 'cross-dissolve']) {
      expect(transitionCurve(type, 0)).toEqual({ outGain: 1, inGain: 0 });
      const end = transitionCurve(type, 1);
      expect(end.outGain).toBeCloseTo(0);
      expect(end.inGain).toBeCloseTo(1);
    }
    const mid = transitionCurve('crossfade', 0.5);
    expect(mid.outGain ** 2 + mid.inGain ** 2).toBeCloseTo(1);
  });
});
