import { get } from 'svelte/store';
import { activeSequence, mediaById } from '$lib/project/store';
import { formatTimecode } from '$lib/project/time';
import { addToast, playhead } from '$lib/stores/app';
import { exportFrame } from '$lib/export/frame';
import { downloadBlob } from '$lib/export/download';

// the export frame shortcut and the program monitor's context menu both land
// here: one png of the frame under the playhead, named after the sequence
export async function exportCurrentFrame(): Promise<void> {
  const seq = get(activeSequence);
  if (!seq) return;
  const time = get(playhead);
  const media = get(mediaById);
  try {
    const blob = await exportFrame(seq, time, { format: 'png' }, (id) => media.get(id));
    // colons are not allowed in file names on windows
    const stamp = formatTimecode(time, seq.fps).replace(/[:;]/g, '.');
    const name = `${seq.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'frame'} ${stamp}.png`;
    downloadBlob(blob, name);
    addToast(`Exported ${name}`, 'success');
  } catch (error) {
    addToast(error instanceof Error ? error.message : 'Could not export the frame', 'error', 5000);
  }
}
