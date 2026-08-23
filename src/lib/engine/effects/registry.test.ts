import { describe, expect, it } from 'vitest';
import {
  audioEffectGroups, createEffectInstance, defaultParams, effectDef, effectDefs, fadeKeyframes,
  isAudioEffectType, isFixedEffectType, isVideoEffectType, videoEffectGroups
} from './registry';

describe('effect registry', () => {
  it('has unique types and names', () => {
    const types = effectDefs.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    const names = effectDefs.map((d) => `${d.kind === 'audio' || d.type === 'volume' || d.type === 'pan' ? 'a' : 'v'}:${d.name}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every param a default matching its kind and a unique key', () => {
    for (const def of effectDefs) {
      const keys = def.params.map((p) => p.key);
      expect(new Set(keys).size, def.type).toBe(keys.length);
      for (const p of def.params) {
        const label = `${def.type}.${p.key}`;
        switch (p.kind) {
          case 'number':
          case 'angle':
            expect(typeof p.default, label).toBe('number');
            expect(p.min, label).toBeTypeOf('number');
            expect(p.max, label).toBeTypeOf('number');
            expect(p.default as number, label).toBeGreaterThanOrEqual(p.min as number);
            expect(p.default as number, label).toBeLessThanOrEqual(p.max as number);
            break;
          case 'boolean':
            expect(typeof p.default, label).toBe('boolean');
            break;
          case 'color':
            expect(p.default, label).toMatch(/^#[0-9a-f]{6}$/);
            break;
          case 'select':
            expect(p.options?.some((o) => o.value === p.default), label).toBe(true);
            expect(p.animatable, label).toBe(false);
            break;
          case 'point':
            expect(Array.isArray(p.default) && p.default.length === 2, label).toBe(true);
            expect(p.min, label).toBeTypeOf('number');
            expect(p.max, label).toBeTypeOf('number');
            for (const v of p.default as [number, number]) {
              expect(v, label).toBeGreaterThanOrEqual(p.min as number);
              expect(v, label).toBeLessThanOrEqual(p.max as number);
            }
            break;
        }
      }
    }
  });

  it('bounds every numeric param, points included', () => {
    const unbounded = effectDefs.flatMap((d) =>
      d.params
        .filter((p) => (p.kind === 'number' || p.kind === 'angle' || p.kind === 'point') && (p.min === undefined || p.max === undefined))
        .map((p) => `${d.type}.${p.key}`)
    );
    expect(unbounded).toEqual([]);
    // motion is the one that ends up off screen when it is not bounded
    const position = effectDef('transform')?.params.find((p) => p.key === 'position');
    expect(position?.min).toBeLessThan(-1000);
    expect(position?.max).toBeGreaterThan(1000);
    expect(effectDef('transform')?.params.find((p) => p.key === 'anchor')?.max).toBe(position?.max);
  });

  it('uses only the documented groups', () => {
    for (const def of effectDefs) {
      const groups = isAudioEffectType(def.type) ? audioEffectGroups : videoEffectGroups;
      expect(groups, def.type).toContain(def.group);
    }
  });

  it('has the fixed effects and treats crop as a normal video effect', () => {
    for (const type of ['transform', 'opacity', 'volume', 'pan']) {
      expect(effectDef(type)?.kind, type).toBe('fixed');
      expect(isFixedEffectType(type)).toBe(true);
    }
    expect(effectDef('crop')?.kind).toBe('video');
    expect(isFixedEffectType('crop')).toBe(false);
    expect(isVideoEffectType('transform')).toBe(true);
    expect(isVideoEffectType('gain')).toBe(false);
    expect(isAudioEffectType('volume')).toBe(true);
  });

  it('creates instances from the defaults without sharing arrays', () => {
    const a = createEffectInstance('transform');
    const b = createEffectInstance('transform');
    expect(a.fixed).toBe(true);
    expect(a.params.position).toEqual([0, 0]);
    expect(a.params.position).not.toBe(b.params.position);
    expect(a.keyframes).toEqual({});
    expect(createEffectInstance('gaussian-blur').fixed).toBeUndefined();
    expect(defaultParams('nope')).toEqual({});
    expect(() => createEffectInstance('nope')).toThrow();
  });

  it('builds fade presets that fit the clip', () => {
    expect(fadeKeyframes('in', 0.5, 1).map((k) => k.time)).toEqual([0, 0.5]);
    expect(fadeKeyframes('out', 4, 1).map((k) => k.time)).toEqual([3, 4]);
  });
});
