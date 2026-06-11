import { describe, it, expect } from 'vitest';
import { computeSpriteTransform, cropRect, fillScale, fitScale, readTransform } from './transform';

describe('readTransform', () => {
  it('falls back to a centered, unscaled placement', () => {
    const t = readTransform(undefined);
    expect(t).toEqual({
      position: [0, 0], scale: 100, scaleY: 100, uniformScale: true,
      rotation: 0, anchor: [0, 0], flipH: false, flipV: false
    });
  });

  it('ignores values of the wrong shape', () => {
    const t = readTransform({ position: 'nope', scale: true, anchor: [1, 2], rotation: Number.NaN });
    expect(t.position).toEqual([0, 0]);
    expect(t.scale).toBe(100);
    expect(t.anchor).toEqual([1, 2]);
    expect(t.rotation).toBe(0);
  });
});

describe('computeSpriteTransform', () => {
  it('centers native size media in the frame', () => {
    const s = computeSpriteTransform(readTransform(undefined), 3840, 2160, 1920, 1080);
    expect(s.x).toBe(960);
    expect(s.y).toBe(540);
    expect(s.scaleX).toBe(1);
    expect(s.scaleY).toBe(1);
    expect(s.rotation).toBe(0);
    expect(s.anchor).toEqual({ x: 0.5, y: 0.5 });
    expect(s.pivot).toEqual({ x: 1920, y: 1080 });
  });

  it('applies position, anchor, scale and rotation', () => {
    const s = computeSpriteTransform(
      readTransform({ position: [100, -50], scale: 50, scaleY: 25, uniformScale: false, rotation: 90, anchor: [-200, 100] }),
      1000, 500, 1920, 1080
    );
    expect(s.x).toBe(1060);
    expect(s.y).toBe(490);
    expect(s.scaleX).toBe(0.5);
    expect(s.scaleY).toBe(0.25);
    expect(s.rotation).toBeCloseTo(Math.PI / 2);
    expect(s.pivot).toEqual({ x: 300, y: 350 });
    expect(s.anchor.x).toBeCloseTo(0.3);
    expect(s.anchor.y).toBeCloseTo(0.7);
  });

  it('uses the uniform scale for both axes when locked', () => {
    const s = computeSpriteTransform(readTransform({ scale: 200, scaleY: 10, uniformScale: true }), 100, 100, 100, 100);
    expect(s.scaleY).toBe(2);
  });

  it('flips by negating the scale', () => {
    const s = computeSpriteTransform(readTransform({ flipH: true, flipV: true, scale: 80 }), 100, 100, 100, 100);
    expect(s.scaleX).toBeCloseTo(-0.8);
    expect(s.scaleY).toBeCloseTo(-0.8);
  });

  it('survives zero sized media', () => {
    const s = computeSpriteTransform(readTransform(undefined), 0, 0, 1920, 1080);
    expect(Number.isFinite(s.anchor.x)).toBe(true);
  });
});

describe('fitScale / fillScale', () => {
  it('fits 4k into 1080p at 50%', () => {
    expect(fitScale({ width: 3840, height: 2160 }, { width: 1920, height: 1080 })).toBe(50);
  });

  it('fits the longer side for portrait media', () => {
    expect(fitScale({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })).toBeCloseTo(56.25);
    expect(fillScale({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })).toBeCloseTo(177.78, 1);
  });

  it('returns 100 for audio sized media', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 1920, height: 1080 })).toBe(100);
  });
});

describe('cropRect', () => {
  it('turns edge percentages into the visible rectangle', () => {
    expect(cropRect({ left: 10, top: 20, right: 30, bottom: 40 }, 1000, 500)).toEqual({ x: 100, y: 100, width: 600, height: 200 });
  });

  it('never goes negative', () => {
    const r = cropRect({ left: 80, right: 80 }, 1000, 500);
    expect(r.width).toBe(0);
  });
});
