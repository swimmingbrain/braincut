import { describe, expect, it } from 'vitest';
import { formatDuration, formatTime, formatTimecode, frameToTime, nearlyEqual, parseTimecode, snapToFrame, timeToFrame } from './time';

describe('frames', () => {
  it('rounds float noise onto the frame', () => {
    expect(timeToFrame(0.1 + 0.2, 10)).toBe(3);
    expect(timeToFrame(29.999999, 30)).toBe(900);
    expect(timeToFrame(1 / 30 * 7, 30)).toBe(7);
  });

  it('snaps to the grid and back', () => {
    expect(snapToFrame(0.51, 25)).toBeCloseTo(0.52, 9);
    expect(frameToTime(timeToFrame(2.5, 24), 24)).toBe(2.5);
    expect(nearlyEqual(0.1 + 0.2, 0.3)).toBe(true);
  });
});

describe('formatTimecode', () => {
  it('formats non drop frame', () => {
    expect(formatTimecode(0, 25)).toBe('00:00:00:00');
    expect(formatTimecode(61.5, 24)).toBe('00:01:01:12');
    expect(formatTimecode(3600 + 2, 30)).toBe('01:00:02:00');
    expect(formatTimecode(5, 25, { showHours: false })).toBe('00:05:00');
  });

  it('uses drop frame at 29.97', () => {
    expect(formatTimecode(0, 29.97)).toBe('00:00:00;00');
    // frame 1800 is the first frame after the first minute, labels ;00 and ;01 are skipped
    expect(formatTimecode(frameToTime(1800, 29.97), 29.97)).toBe('00:01:00;02');
    expect(formatTimecode(frameToTime(1799, 29.97), 29.97)).toBe('00:00:59;29');
    // every tenth minute keeps its labels
    expect(formatTimecode(frameToTime(17982, 29.97), 29.97)).toBe('00:10:00;00');
    expect(formatTimecode(3600, 29.97)).toBe('01:00:00;00');
  });

  it('drops four frames at 59.94', () => {
    expect(formatTimecode(frameToTime(3600, 59.94), 59.94)).toBe('00:01:00;04');
  });

  it('can be forced either way', () => {
    expect(formatTimecode(frameToTime(1800, 29.97), 29.97, { dropFrame: false })).toBe('00:01:00:00');
    expect(formatTimecode(1, 30, { dropFrame: true })).toBe('00:00:01;00');
  });
});

describe('parseTimecode', () => {
  it('reads full and short timecodes', () => {
    expect(parseTimecode('00:01:23:10', 25)).toBeCloseTo(83.4, 9);
    expect(parseTimecode('1:23', 25)).toBeCloseTo(1 + 23 / 25, 9);
    expect(parseTimecode('1:02:03:04', 24)).toBeCloseTo(3723 + 4 / 24, 9);
  });

  it('reads packed digits from the right', () => {
    expect(parseTimecode('123', 25)).toBeCloseTo(1 + 23 / 25, 9);
    expect(parseTimecode('10', 25)).toBeCloseTo(10 / 25, 9);
    expect(parseTimecode('10000', 30)).toBeCloseTo(60, 9);
  });

  it('reads relative frames', () => {
    expect(parseTimecode('+10', 25, 2)).toBeCloseTo(2.4, 9);
    expect(parseTimecode('-10', 25, 0.2)).toBe(0);
  });

  it('round trips drop frame', () => {
    const t = frameToTime(1800, 29.97);
    expect(timeToFrame(parseTimecode('00:01:00;02', 29.97)!, 29.97)).toBe(1800);
    expect(parseTimecode(formatTimecode(t, 29.97), 29.97)).toBeCloseTo(t, 9);
    const later = frameToTime(123456, 29.97);
    expect(parseTimecode(formatTimecode(later, 29.97), 29.97)).toBeCloseTo(later, 9);
  });

  it('rejects garbage', () => {
    expect(parseTimecode('abc', 25)).toBeNull();
    expect(parseTimecode('', 25)).toBeNull();
    expect(parseTimecode('1:2:3:4:5', 25)).toBeNull();
  });
});

describe('formatDuration and formatTime', () => {
  it('formats durations', () => {
    expect(formatDuration(83.4)).toBe('1:23.4');
    expect(formatDuration(3723.4)).toBe('1:02:03.4');
    expect(formatDuration(0)).toBe('0:00.0');
  });

  it('formats by preference', () => {
    expect(formatTime(2, 25, 'frames')).toBe('50');
    expect(formatTime(2, 25, 'seconds')).toBe('2.00s');
    expect(formatTime(2, 25, 'timecode')).toBe('00:00:02:00');
  });
});
