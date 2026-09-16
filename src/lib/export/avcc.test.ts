import { describe, expect, it } from 'vitest';
import { rebuildAvcDescription } from './avcc';

const bytes = (hex: string) => new Uint8Array(hex.trim().split(/\s+/).map((h) => parseInt(h, 16)));

// a length prefixed packet from the given nal units
function packet(...nals: Uint8Array[]): Uint8Array {
  const out: number[] = [];
  for (const nal of nals) out.push(0, 0, nal.length >> 8, nal.length & 0xff, ...nal);
  return new Uint8Array(out);
}

// the parameter sets and record of a real firefox export, 1080x1920 high
// profile at level 4.2. the sps holds an emulation prevention byte
const HIGH_SPS = bytes('67 64 00 2a ac 2c ac 04 40 3c 79 78 40 00 00 03 00 40 00 00 1e 03 68 22 11 4e');
const HIGH_PPS = bytes('68 ce 3c 30');
const AUD = bytes('09 10');
const SEI = bytes('06 05 2f 02 f8 61 50 fc');
const IDR = bytes('65 88 80 40 0b ff ff f0');
const FIREFOX_RECORD = bytes(
  '01 64 00 2a 03 01 00 1b 67 67 64 00 2a ac 2c ac 04 40 3c 79 78 40 00 00 03 00 40 00 00 1e 03 68 22 11 4e 01 00 05 68 68 ce 3c 30'
);
const HIGH_RECORD = bytes(
  '01 64 00 2a ff e1 00 1a 67 64 00 2a ac 2c ac 04 40 3c 79 78 40 00 00 03 00 40 00 00 1e 03 68 22 11 4e 01 00 04 68 ce 3c 30 fd f8 f8 00'
);

// main profile from another encoder, no trailer on the record
const MAIN_SPS = bytes('67 4d 04 2a e8 a0 22 01 e3 cb ff e0 00 20 00 28 40 00 00 50 00 00 03 00 10 00 00 07 88 f0 88 46 58');
const MAIN_PPS = bytes('68 ee 3c 80');
const MAIN_RECORD = bytes(
  '01 4d 04 2a ff e1 00 21 67 4d 04 2a e8 a0 22 01 e3 cb ff e0 00 20 00 28 40 00 00 50 00 00 03 00 10 00 00 07 88 f0 88 46 58 01 00 04 68 ee 3c 80'
);

describe('rebuildAvcDescription', () => {
  it('replaces the doubled parameter sets firefox writes with the ones in the keyframe', () => {
    const fixed = rebuildAvcDescription(FIREFOX_RECORD, packet(AUD, HIGH_SPS, HIGH_PPS, SEI, IDR));
    expect(fixed).toEqual(HIGH_RECORD);
  });

  it('takes the record as an array buffer too', () => {
    const fixed = rebuildAvcDescription(FIREFOX_RECORD.buffer, packet(HIGH_SPS, HIGH_PPS, IDR));
    expect(fixed).toEqual(HIGH_RECORD);
  });

  it('leaves the trailer off below the high profiles', () => {
    const fixed = rebuildAvcDescription(MAIN_RECORD, packet(AUD, MAIN_SPS, MAIN_PPS, IDR));
    expect(fixed).toEqual(MAIN_RECORD);
  });

  it('keeps the length size the record declares', () => {
    const twoByte = HIGH_RECORD.slice();
    twoByte[4] = 0xfd; // lengthSizeMinusOne = 1
    const fixed = rebuildAvcDescription(twoByte, new Uint8Array([0, HIGH_SPS.length, ...HIGH_SPS, 0, HIGH_PPS.length, ...HIGH_PPS]));
    expect(fixed?.[4]).toBe(0xfd);
    expect(fixed?.subarray(8, 8 + HIGH_SPS.length)).toEqual(HIGH_SPS);
  });

  it('gives up when the keyframe carries no parameter sets', () => {
    expect(rebuildAvcDescription(HIGH_RECORD, packet(SEI, IDR))).toBeNull();
  });

  it('gives up on annex b packets and records it does not recognise', () => {
    const annexB = new Uint8Array([0, 0, 0, 1, ...HIGH_SPS, 0, 0, 0, 1, ...HIGH_PPS]);
    expect(rebuildAvcDescription(HIGH_RECORD, annexB)).toBeNull();
    expect(rebuildAvcDescription(new Uint8Array([2, 0, 0]), packet(HIGH_SPS, HIGH_PPS))).toBeNull();
  });

  it('stops at a length that runs off the packet', () => {
    const truncated = packet(HIGH_SPS, HIGH_PPS).subarray(0, 20);
    expect(rebuildAvcDescription(HIGH_RECORD, truncated)).toBeNull();
  });
});
