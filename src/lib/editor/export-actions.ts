import { get } from 'svelte/store';
import { activeSequence, mediaById } from '$lib/project/store';
import { formatTimecode } from '$lib/project/time';
import { addToast, contextMenu, playhead, type MenuItem } from '$lib/stores/app';
import { exportFrame, type FrameOptions } from '$lib/export/frame';
import { downloadBlob } from '$lib/export/download';

export type FrameFormat = FrameOptions['format'];

// what the two commands and the program monitor offer. png keeps every pixel
// exactly, jpeg is a fraction of the size for a still to send someone
export const frameFormats: { format: FrameFormat; label: string; extension: string }[] = [
  { format: 'png', label: 'PNG', extension: 'png' },
  { format: 'jpeg', label: 'JPEG', extension: 'jpg' }
];

const JPEG_QUALITY = 0.92;

// the export frame shortcut, the palette and the program monitor all land
// here: one image of the frame under the playhead, named after the sequence
export async function exportCurrentFrame(format: FrameFormat = 'png'): Promise<void> {
  const seq = get(activeSequence);
  if (!seq) return;
  const time = get(playhead);
  const media = get(mediaById);
  const extension = frameFormats.find((f) => f.format === format)?.extension ?? 'png';
  try {
    const blob = await exportFrame(seq, time, { format, quality: JPEG_QUALITY }, (id) => media.get(id));
    // colons are not allowed in file names on windows
    const stamp = formatTimecode(time, seq.fps).replace(/[:;]/g, '.');
    const name = `${seq.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'frame'} ${stamp}.${extension}`;
    downloadBlob(blob, name);
    addToast(`Exported ${name}`, 'success');
  } catch (error) {
    addToast(error instanceof Error ? error.message : 'Could not export the frame', 'error', 5000);
  }
}

// the same two formats as menu entries. anything that can show a menu offers
// both without knowing what the frame encoder supports
export function frameExportItems(): MenuItem[] {
  return frameFormats.map((f) => ({ label: f.label, action: () => void exportCurrentFrame(f.format) }));
}

// for a plain button with nowhere to hang a submenu: the entries are dropped
// under it instead
export function openFrameExportMenu(event: MouseEvent): void {
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
  contextMenu.set({ x: rect ? rect.left : event.clientX, y: rect ? rect.bottom + 2 : event.clientY, items: frameExportItems() });
}
