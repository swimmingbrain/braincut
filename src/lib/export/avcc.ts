// the avcC box an mp4 carries for h.264 comes straight from the browser as
// decoderConfig.description. firefox on windows hands over a broken one: each
// parameter set has its nal header byte twice, the reserved bits are zero and
// the high profile trailer is missing. players that trust the box over the
// stream, whatsapp and the windows thumbnailer among them, give up on the
// file while ones that read the in-band sets play it fine. the keyframe
// carries the real sps and pps, so the record is rebuilt from those whenever
// they are there (iso 14496-15, 5.3.3.1)

const SPS = 7;
const PPS = 8;
const SPS_EXT = 13;
// profiles whose record ends with chroma format and bit depths
const HIGH_PROFILES = new Set([100, 110, 122, 144]);
// profiles whose sps spells out the chroma format (h.264 7.3.2.1.1)
const CHROMA_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

interface SpsInfo {
  profile: number;
  constraints: number;
  level: number;
  chromaFormat: number;
  bitDepthLuma: number;
  bitDepthChroma: number;
}

// a fresh record for the description, or null when the packet has no
// parameter sets to build one from and the browser's record has to do
export function rebuildAvcDescription(description: AllowSharedBufferSource, packet: Uint8Array): Uint8Array | null {
  const current = toBytes(description);
  if (current.length < 7 || current[0] !== 1) return null;
  if (isAnnexB(packet)) return null;
  const lengthSize = (current[4] & 3) + 1;

  const sps: Uint8Array[] = [];
  const pps: Uint8Array[] = [];
  const ext: Uint8Array[] = [];
  for (const nal of nalUnits(packet, lengthSize)) {
    const type = nal[0] & 31;
    if (type === SPS) sps.push(nal);
    else if (type === PPS) pps.push(nal);
    else if (type === SPS_EXT) ext.push(nal);
  }
  if (sps.length === 0 || pps.length === 0) return null;
  const info = parseSps(sps[0]);
  if (!info) return null;

  const out: number[] = [1, info.profile, info.constraints, info.level, 0xfc | (lengthSize - 1), 0xe0 | sps.length];
  for (const set of sps) out.push(set.length >> 8, set.length & 0xff, ...set);
  out.push(pps.length);
  for (const set of pps) out.push(set.length >> 8, set.length & 0xff, ...set);
  if (HIGH_PROFILES.has(info.profile)) {
    out.push(0xfc | info.chromaFormat, 0xf8 | info.bitDepthLuma, 0xf8 | info.bitDepthChroma, ext.length);
    for (const set of ext) out.push(set.length >> 8, set.length & 0xff, ...set);
  }
  return new Uint8Array(out);
}

function toBytes(source: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return new Uint8Array(source);
}

function isAnnexB(packet: Uint8Array): boolean {
  return (packet[0] === 0 && packet[1] === 0 && packet[2] === 1) || (packet[0] === 0 && packet[1] === 0 && packet[2] === 0 && packet[3] === 1);
}

// the nal units of a length prefixed packet, stopping at the first length
// that runs off the end
function* nalUnits(packet: Uint8Array, lengthSize: number): Generator<Uint8Array> {
  let at = 0;
  while (at + lengthSize <= packet.length) {
    let length = 0;
    for (let i = 0; i < lengthSize; i++) length = (length << 8) | packet[at + i];
    at += lengthSize;
    if (length <= 0 || at + length > packet.length) return;
    yield packet.subarray(at, at + length);
    at += length;
  }
}

// the head of the sps, through to the bit depths. read from the rbsp, so the
// emulation prevention bytes come out first
function parseSps(nal: Uint8Array): SpsInfo | null {
  if (nal.length < 4) return null;
  const profile = nal[1];
  const constraints = nal[2];
  const level = nal[3];
  const info: SpsInfo = { profile, constraints, level, chromaFormat: 1, bitDepthLuma: 0, bitDepthChroma: 0 };
  if (!CHROMA_PROFILES.has(profile)) return info;
  try {
    const bits = new Bits(unescape(nal.subarray(4)));
    bits.ue(); // seq_parameter_set_id
    info.chromaFormat = bits.ue();
    if (info.chromaFormat === 3) bits.bit(); // separate_colour_plane_flag
    info.bitDepthLuma = bits.ue();
    info.bitDepthChroma = bits.ue();
  } catch {
    return null;
  }
  return info;
}

function unescape(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (const b of bytes) {
    if (zeros >= 2 && b === 3) {
      zeros = 0;
      continue;
    }
    out.push(b);
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return new Uint8Array(out);
}

class Bits {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  bit(): number {
    const byte = this.bytes[this.pos >> 3];
    if (byte === undefined) throw new RangeError('sps ends early');
    const value = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return value;
  }

  // unsigned exp-golomb
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) {
      zeros++;
      if (zeros > 31) throw new RangeError('bad exp-golomb code');
    }
    let value = 0;
    for (let i = 0; i < zeros; i++) value = (value << 1) | this.bit();
    return (1 << zeros) - 1 + value;
  }
}
