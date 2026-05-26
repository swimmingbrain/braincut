import bezier from 'bezier-easing';
import type { Easing, EffectInstance, Keyframe, ParamValue } from './types';

// keyframe times are relative to the clip start, so anything closer than
// this counts as the same frame at any sensible frame rate
const TOL = 1e-4;

const curves: Record<Exclude<Easing, 'linear' | 'hold'>, (x: number) => number> = {
  'ease-in': bezier(0.42, 0, 1, 1),
  'ease-out': bezier(0, 0, 0.58, 1),
  'ease-in-out': bezier(0.42, 0, 0.58, 1)
};

function ease(easing: Easing, t: number): number {
  if (easing === 'linear') return t;
  if (easing === 'hold') return 0;
  return curves[easing](t);
}

function isPoint(v: ParamValue): v is [number, number] {
  return Array.isArray(v);
}

function mix(a: ParamValue, b: ParamValue, t: number): ParamValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (isPoint(a) && isPoint(b)) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  // booleans and strings have nothing in between
  return t < 1 ? a : b;
}

export function interpolate(keyframes: Keyframe[], time: number, fallback?: ParamValue): ParamValue | undefined {
  if (keyframes.length === 0) return fallback;
  if (time <= keyframes[0].time) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last.value;
  let i = 0;
  while (i < keyframes.length - 1 && keyframes[i + 1].time <= time) i++;
  const a = keyframes[i];
  const b = keyframes[i + 1];
  const span = b.time - a.time;
  if (span <= 0) return b.value;
  // the easing of a keyframe shapes the segment leaving it
  const t = ease(a.easing, (time - a.time) / span);
  return mix(a.value, b.value, t);
}

export function valueAt(effect: EffectInstance, key: string, clipTime: number, fallback?: ParamValue): ParamValue {
  const keyframes = effect.keyframes[key];
  if (keyframes && keyframes.length > 0) return interpolate(keyframes, clipTime) as ParamValue;
  const value = effect.params[key] ?? fallback;
  if (value === undefined) throw new Error(`effect ${effect.type} has no param ${key}`);
  return value;
}

export function paramsAt(effect: EffectInstance, clipTime: number): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...effect.params };
  for (const key of Object.keys(effect.keyframes)) {
    const value = interpolate(effect.keyframes[key], clipTime, effect.params[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function isAnimated(effect: EffectInstance, key: string): boolean {
  return (effect.keyframes[key]?.length ?? 0) > 0;
}

export function keyframeAt(effect: EffectInstance, key: string, time: number, tol = TOL): Keyframe | null {
  return effect.keyframes[key]?.find((k) => Math.abs(k.time - time) <= tol) ?? null;
}

// inserts or updates the keyframe at time, keeping the list sorted
export function setKeyframe(effect: EffectInstance, key: string, time: number, value: ParamValue, easing?: Easing): Keyframe {
  const list = (effect.keyframes[key] ??= []);
  const existing = list.find((k) => Math.abs(k.time - time) <= TOL);
  if (existing) {
    existing.value = value;
    if (easing) existing.easing = easing;
    return existing;
  }
  const created: Keyframe = { time, value, easing: easing ?? 'linear' };
  list.push(created);
  list.sort((a, b) => a.time - b.time);
  return created;
}

export function removeKeyframe(effect: EffectInstance, key: string, time: number): boolean {
  const list = effect.keyframes[key];
  if (!list) return false;
  const index = list.findIndex((k) => Math.abs(k.time - time) <= TOL);
  if (index < 0) return false;
  list.splice(index, 1);
  if (list.length === 0) delete effect.keyframes[key];
  return true;
}

// the stopwatch: on turns the static value into a first keyframe, off
// bakes the value at the current time back into the params
export function toggleAnimated(effect: EffectInstance, key: string, time: number): boolean {
  if (isAnimated(effect, key)) {
    effect.params[key] = valueAt(effect, key, time);
    delete effect.keyframes[key];
    return false;
  }
  const value = effect.params[key];
  if (value === undefined) throw new Error(`effect ${effect.type} has no param ${key}`);
  setKeyframe(effect, key, time, value);
  return true;
}

export function moveKeyframe(effect: EffectInstance, key: string, time: number, newTime: number): boolean {
  const list = effect.keyframes[key];
  if (!list) return false;
  const kf = list.find((k) => Math.abs(k.time - time) <= TOL);
  if (!kf) return false;
  // moving onto another keyframe swallows it
  const other = list.find((k) => k !== kf && Math.abs(k.time - newTime) <= TOL);
  if (other) list.splice(list.indexOf(other), 1);
  kf.time = newTime;
  list.sort((a, b) => a.time - b.time);
  return true;
}

export function setKeyframeEasing(effect: EffectInstance, key: string, time: number, easing: Easing): boolean {
  const kf = keyframeAt(effect, key, time);
  if (!kf) return false;
  kf.easing = easing;
  return true;
}

function allTimes(effect: EffectInstance): number[] {
  const times = new Set<number>();
  for (const list of Object.values(effect.keyframes)) for (const k of list) times.add(k.time);
  return [...times].sort((a, b) => a - b);
}

export function nextKeyframeTime(effect: EffectInstance, time: number): number | null {
  return allTimes(effect).find((t) => t > time + TOL) ?? null;
}

export function prevKeyframeTime(effect: EffectInstance, time: number): number | null {
  const before = allTimes(effect).filter((t) => t < time - TOL);
  return before.length ? before[before.length - 1] : null;
}
