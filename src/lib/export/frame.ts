import type { Sequence } from '$lib/project/types';
import { openScene, type GetMedia } from './scene';

export interface FrameOptions {
  format: 'png' | 'jpeg';
  // 0..1, jpeg only
  quality?: number;
}

// renders one frame at full sequence size and hands it back as an image.
// the pixels are copied to a 2d canvas right after the render, because a
// webgl canvas may be blank again by the time toBlob gets to it
export async function exportFrame(sequence: Sequence, time: number, options: FrameOptions, getMedia: GetMedia): Promise<Blob> {
  const scene = openScene(sequence, sequence.width, sequence.height, getMedia);
  try {
    await scene.render(time);
    const copy = document.createElement('canvas');
    copy.width = sequence.width;
    copy.height = sequence.height;
    const ctx = copy.getContext('2d');
    if (!ctx) throw new Error("Couldn't get a drawing context for the frame.");
    ctx.drawImage(scene.canvas, 0, 0, sequence.width, sequence.height);
    const type = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob | null>((resolve) => copy.toBlob(resolve, type, options.quality ?? 0.92));
    if (!blob) throw new Error("The browser couldn't encode the frame.");
    return blob;
  } finally {
    scene.close();
  }
}
