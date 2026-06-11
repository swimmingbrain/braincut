import type { ParamValue } from '$lib/project/types';

// the fixed transform effect of a visual clip, read from its params. media is
// placed like a desktop nle does it: 100% is the native pixel size, centered
// in the frame, so a 4k clip in a 1080p sequence overflows until it is scaled
export interface TransformParams {
  // px offset of the anchor point from the frame center
  position: [number, number];
  // percent
  scale: number;
  scaleY: number;
  uniformScale: boolean;
  // degrees, clockwise
  rotation: number;
  // px offset of the anchor point from the media center
  anchor: [number, number];
  flipH: boolean;
  flipV: boolean;
}

export interface SpriteTransform {
  // where the pivot lands in the frame, px
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  // radians
  rotation: number;
  // pivot as a fraction of the media size
  anchor: { x: number; y: number };
  // pivot in media px
  pivot: { x: number; y: number };
}

function num(v: ParamValue | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function bool(v: ParamValue | undefined, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function point(v: ParamValue | undefined): [number, number] {
  if (Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])) return [v[0], v[1]];
  return [0, 0];
}

export function readTransform(params: Record<string, ParamValue> | undefined): TransformParams {
  const p = params ?? {};
  return {
    position: point(p.position),
    scale: num(p.scale, 100),
    scaleY: num(p.scaleY, 100),
    uniformScale: bool(p.uniformScale, true),
    rotation: num(p.rotation, 0),
    anchor: point(p.anchor),
    flipH: bool(p.flipH, false),
    flipV: bool(p.flipV, false)
  };
}

export function computeSpriteTransform(
  params: TransformParams,
  mediaW: number,
  mediaH: number,
  seqW: number,
  seqH: number
): SpriteTransform {
  const w = Math.max(1, mediaW);
  const h = Math.max(1, mediaH);
  const pivotX = w / 2 + params.anchor[0];
  const pivotY = h / 2 + params.anchor[1];
  const sx = params.scale / 100;
  const sy = (params.uniformScale ? params.scale : params.scaleY) / 100;
  return {
    x: seqW / 2 + params.position[0],
    y: seqH / 2 + params.position[1],
    scaleX: params.flipH ? -sx : sx,
    scaleY: params.flipV ? -sy : sy,
    rotation: (params.rotation * Math.PI) / 180,
    anchor: { x: pivotX / w, y: pivotY / h },
    pivot: { x: pivotX, y: pivotY }
  };
}

// scale percent that makes the whole media visible inside the frame, what
// the set to frame size action writes into the transform
export function fitScale(media: { width: number; height: number }, seq: { width: number; height: number }): number {
  if (media.width <= 0 || media.height <= 0) return 100;
  return Math.min(seq.width / media.width, seq.height / media.height) * 100;
}

// scale percent that fills the frame completely, cropping the longer side
export function fillScale(media: { width: number; height: number }, seq: { width: number; height: number }): number {
  if (media.width <= 0 || media.height <= 0) return 100;
  return Math.max(seq.width / media.width, seq.height / media.height) * 100;
}

// the crop effect keeps percentages of each edge, this turns them into the
// rectangle that stays visible, in media px
export function cropRect(
  params: Record<string, ParamValue> | undefined,
  mediaW: number,
  mediaH: number
): { x: number; y: number; width: number; height: number } {
  const p = params ?? {};
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  const left = clamp(num(p.left, 0));
  const top = clamp(num(p.top, 0));
  const right = clamp(num(p.right, 0));
  const bottom = clamp(num(p.bottom, 0));
  const x = (left / 100) * mediaW;
  const y = (top / 100) * mediaH;
  const width = Math.max(0, mediaW - x - (right / 100) * mediaW);
  const height = Math.max(0, mediaH - y - (bottom / 100) * mediaH);
  return { x, y, width, height };
}
