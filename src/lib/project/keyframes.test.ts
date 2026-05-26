import { describe, expect, it } from 'vitest';
import { isAnimated, keyframeAt, moveKeyframe, nextKeyframeTime, paramsAt, prevKeyframeTime, removeKeyframe, setKeyframe, setKeyframeEasing, toggleAnimated, valueAt } from './keyframes';
import type { EffectInstance } from './types';

function effect(): EffectInstance {
  return {
    id: 'e', type: 'transform', enabled: true, fixed: true,
    params: { position: [0, 0], scale: 100, flipH: false, blendMode: 'normal' },
    keyframes: {}
  };
}

describe('keyframes', () => {
  it('returns the static value without keyframes', () => {
    expect(valueAt(effect(), 'scale', 3)).toBe(100);
    expect(valueAt(effect(), 'missing', 0, 7)).toBe(7);
    expect(() => valueAt(effect(), 'missing', 0)).toThrow();
  });

  it('interpolates numbers and points, holds before and after', () => {
    const e = effect();
    setKeyframe(e, 'scale', 1, 0);
    setKeyframe(e, 'scale', 3, 100);
    expect(valueAt(e, 'scale', 0)).toBe(0);
    expect(valueAt(e, 'scale', 2)).toBe(50);
    expect(valueAt(e, 'scale', 9)).toBe(100);
    setKeyframe(e, 'position', 0, [0, 0]);
    setKeyframe(e, 'position', 2, [10, -20]);
    expect(valueAt(e, 'position', 1)).toEqual([5, -10]);
  });

  it('holds booleans and strings and hold easing', () => {
    const e = effect();
    setKeyframe(e, 'flipH', 0, false);
    setKeyframe(e, 'flipH', 2, true);
    expect(valueAt(e, 'flipH', 1)).toBe(false);
    expect(valueAt(e, 'flipH', 2)).toBe(true);
    setKeyframe(e, 'scale', 0, 0, 'hold');
    setKeyframe(e, 'scale', 2, 100);
    expect(valueAt(e, 'scale', 1.99)).toBe(0);
    expect(valueAt(e, 'scale', 2)).toBe(100);
  });

  it('eases', () => {
    const e = effect();
    setKeyframe(e, 'scale', 0, 0, 'ease-in');
    setKeyframe(e, 'scale', 2, 100);
    const early = valueAt(e, 'scale', 0.5) as number;
    expect(early).toBeLessThan(25);
    setKeyframeEasing(e, 'scale', 0, 'ease-out');
    expect(valueAt(e, 'scale', 0.5) as number).toBeGreaterThan(25);
    setKeyframeEasing(e, 'scale', 0, 'ease-in-out');
    expect(valueAt(e, 'scale', 1) as number).toBeCloseTo(50, 5);
  });

  it('keeps the list sorted and updates in place', () => {
    const e = effect();
    setKeyframe(e, 'scale', 2, 20);
    setKeyframe(e, 'scale', 1, 10);
    setKeyframe(e, 'scale', 2, 25, 'ease-in');
    expect(e.keyframes.scale.map((k) => [k.time, k.value, k.easing])).toEqual([[1, 10, 'linear'], [2, 25, 'ease-in']]);
    expect(keyframeAt(e, 'scale', 2.00001)?.value).toBe(25);
    expect(removeKeyframe(e, 'scale', 1)).toBe(true);
    expect(removeKeyframe(e, 'scale', 1)).toBe(false);
    expect(removeKeyframe(e, 'scale', 2)).toBe(true);
    expect(isAnimated(e, 'scale')).toBe(false);
    expect('scale' in e.keyframes).toBe(false);
  });

  it('toggles animation and bakes the value back', () => {
    const e = effect();
    expect(toggleAnimated(e, 'scale', 1)).toBe(true);
    expect(e.keyframes.scale).toEqual([{ time: 1, value: 100, easing: 'linear' }]);
    setKeyframe(e, 'scale', 3, 0);
    expect(toggleAnimated(e, 'scale', 2)).toBe(false);
    expect(e.params.scale).toBe(50);
    expect(isAnimated(e, 'scale')).toBe(false);
  });

  it('moves keyframes and swallows the one it lands on', () => {
    const e = effect();
    setKeyframe(e, 'scale', 1, 10);
    setKeyframe(e, 'scale', 2, 20);
    setKeyframe(e, 'scale', 3, 30);
    expect(moveKeyframe(e, 'scale', 3, 0.5)).toBe(true);
    expect(e.keyframes.scale.map((k) => k.time)).toEqual([0.5, 1, 2]);
    moveKeyframe(e, 'scale', 0.5, 2);
    expect(e.keyframes.scale.map((k) => [k.time, k.value])).toEqual([[1, 10], [2, 30]]);
  });

  it('walks between keyframes of all params', () => {
    const e = effect();
    setKeyframe(e, 'scale', 1, 10);
    setKeyframe(e, 'position', 2.5, [1, 1]);
    expect(nextKeyframeTime(e, 0)).toBe(1);
    expect(nextKeyframeTime(e, 1)).toBe(2.5);
    expect(nextKeyframeTime(e, 3)).toBeNull();
    expect(prevKeyframeTime(e, 3)).toBe(2.5);
    expect(prevKeyframeTime(e, 1)).toBeNull();
    expect(paramsAt(e, 1)).toEqual({ position: [1, 1], scale: 10, flipH: false, blendMode: 'normal' });
  });
});
