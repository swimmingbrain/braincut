import { dragPayload } from '$lib/stores/app';

// what can be picked up and dropped somewhere else in the editor. clip moves
// inside the timeline are handled by pointer events, not html5 drag and drop,
// so they are not in here
export type DragPayload =
  | { kind: 'media'; mediaIds: string[] }
  | { kind: 'source'; mediaId: string; in: number; out: number }
  | { kind: 'effect'; type: string }
  | { kind: 'transition'; type: string };

// our own mime type: the browser hands it to us untouched and anything from
// outside the app (files, urls) never claims it
export const DRAG_MIME = 'application/x-braincut';

export function startDrag(payload: DragPayload, e: DragEvent): void {
  dragPayload.set(payload);
  if (!e.dataTransfer) return;
  e.dataTransfer.effectAllowed = 'copyMove';
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
}

export function readDrag(e: DragEvent): DragPayload | null {
  const raw = e.dataTransfer?.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return null;
  }
}

export function endDrag(): void {
  dragPayload.set(null);
}
