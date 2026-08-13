import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { ToolId } from '$lib/editor/tools';
import type { DragPayload } from '$lib/editor/drag';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export const toasts = writable<Array<{ id: string; message: string; type: ToastType }>>([]);

let toastId = 0;
export function addToast(message: string, type: ToastType = 'info', duration = 3000) {
  const id = String(++toastId);
  toasts.update((t) => [...t, { id, message, type }]);
  if (duration > 0) {
    setTimeout(() => {
      toasts.update((t) => t.filter((toast) => toast.id !== id));
    }, duration);
  }
  return id;
}

export const commandPaletteOpen = writable(false);

export type Workspace = 'edit' | 'color' | 'effects' | 'audio';
export const workspace = writable<Workspace>('edit');

export const activeTool = writable<ToolId>('select');

// seconds into the active sequence
export const playhead = writable(0);
export const playing = writable(false);
export const loopPlayback = writable(false);
// the timeline scrolls along so the playhead stays in view
export const followPlayhead = writable(true);

// clip ids
export const selection = writable<string[]>([]);
export const selectedTransitionId = writable<string | null>(null);
export const selectedEffectId = writable<string | null>(null);

// pixels per second, and the sequence time sitting at the left edge
export const timelineZoom = writable(100);
export const timelineScroll = writable(0);
export const snapEnabled = writable(true);

// what the source monitor is showing, with its own in/out and playhead
export const sourceMedia = writable<{ mediaId: string; in: number; out: number; time: number } | null>(null);

export type LeftPanelTab = 'source' | 'effect-controls' | 'audio-mixer' | 'color';
export type BottomPanelTab = 'project' | 'effects' | 'markers' | 'history';
export const leftPanelTab = writable<LeftPanelTab>('source');
export const bottomPanelTab = writable<BottomPanelTab>('project');

export type Dialog =
  | { kind: 'new-project' }
  | { kind: 'new-sequence' }
  | { kind: 'sequence-settings' }
  | { kind: 'export' }
  | { kind: 'preferences' }
  | { kind: 'shortcuts' }
  | { kind: 'about' }
  | { kind: 'relink'; mediaId: string }
  | { kind: 'speed'; clipIds: string[] }
  | { kind: 'title'; clipId: string }
  | { kind: 'rename'; target: 'project' | 'clip' | 'media' | 'sequence' | 'bin'; id: string };

export const dialog = writable<Dialog | null>(null);

// the file the open project came from or was last saved to, so save can
// write back without asking again. null for projects that only live in
// the browser
export const projectHandle = writable<FileSystemFileHandle | null>(null);

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  checked?: boolean;
  action?: () => void;
  children?: MenuItem[];
}

export const contextMenu = writable<{ x: number; y: number; items: MenuItem[] } | null>(null);

export const exportJob = writable<{ progress: number; stage: string; eta: number | null; cancel(): void } | null>(null);

export type RenderStatus = 'idle' | 'playing' | 'rendering' | 'importing' | 'converting';
export const renderStatus = writable<RenderStatus>('idle');

export const importProgress = writable<{ done: number; total: number; name: string } | null>(null);

// preview resolution factor, dropped while scrubbing big sequences
export const previewQuality = writable<1 | 0.5 | 0.25>(0.5);
export const showSafeMargins = writable(false);

export const dragPayload = writable<DragPayload | null>(null);

export interface PanelSizes {
  leftWidth: number;
  // fraction of the main area the monitor row takes
  topHeight: number;
}

const defaultPanelSizes: PanelSizes = { leftWidth: 420, topHeight: 0.55 };

function createPanelSizes() {
  let initial = defaultPanelSizes;
  if (browser) {
    try {
      const stored = localStorage.getItem('braincut-layout');
      if (stored) initial = { ...defaultPanelSizes, ...JSON.parse(stored) };
    } catch {}
  }

  const { subscribe, set, update } = writable<PanelSizes>(initial);

  function persist(value: PanelSizes) {
    if (browser) {
      try {
        localStorage.setItem('braincut-layout', JSON.stringify(value));
      } catch {}
    }
  }

  return {
    subscribe,
    set(value: PanelSizes) {
      set(value);
      persist(value);
    },
    update(fn: (sizes: PanelSizes) => PanelSizes) {
      update((current) => {
        const next = fn(current);
        persist(next);
        return next;
      });
    }
  };
}

export const panelSizes = createPanelSizes();
