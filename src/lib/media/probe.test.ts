import { describe, expect, it } from 'vitest';
import { codecName, roundFrameRate } from './probe';

describe('roundFrameRate', () => {
  it('snaps measured rates to the common ones', () => {
    expect(roundFrameRate(29.9699)).toBe(29.97);
    expect(roundFrameRate(23.98)).toBe(23.976);
    expect(roundFrameRate(25.01)).toBe(25);
    expect(roundFrameRate(59.95)).toBe(59.94);
  });

  it('keeps odd rates, rounded to a millihertz', () => {
    expect(roundFrameRate(15)).toBe(15);
    expect(roundFrameRate(33.3333)).toBe(33.333);
  });
});

describe('codecName', () => {
  it('uses the names people know', () => {
    expect(codecName('avc')).toBe('H.264');
    expect(codecName('hevc')).toBe('HEVC');
    expect(codecName('pcm-s16')).toBe('PCM');
    expect(codecName(null)).toBe('unknown');
  });
});
