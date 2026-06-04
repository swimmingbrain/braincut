export type ToolId =
  | 'select'
  | 'track-select'
  | 'ripple'
  | 'rolling'
  | 'razor'
  | 'slip'
  | 'slide'
  | 'pen'
  | 'hand'
  | 'zoom'
  | 'text';

export interface Tool {
  id: ToolId;
  label: string;
  shortcut: string;
  // css cursor the timeline uses while the tool is active
  cursor: string;
  // key into the icon set of ui/Icon.svelte
  icon: string;
}

// the order is the order of the strip, which is the order every desktop nle
// puts them in. people reach for them by position as much as by shortcut
export const tools: Tool[] = [
  { id: 'select', label: 'Selection', shortcut: 'V', cursor: 'default', icon: 'select' },
  { id: 'track-select', label: 'Track Select', shortcut: 'A', cursor: 'e-resize', icon: 'trackSelect' },
  { id: 'ripple', label: 'Ripple Edit', shortcut: 'B', cursor: 'col-resize', icon: 'ripple' },
  { id: 'rolling', label: 'Rolling Edit', shortcut: 'N', cursor: 'col-resize', icon: 'rolling' },
  { id: 'razor', label: 'Razor', shortcut: 'C', cursor: 'crosshair', icon: 'razor' },
  { id: 'slip', label: 'Slip', shortcut: 'Y', cursor: 'ew-resize', icon: 'slip' },
  { id: 'slide', label: 'Slide', shortcut: 'U', cursor: 'ew-resize', icon: 'slide' },
  { id: 'pen', label: 'Pen', shortcut: 'P', cursor: 'crosshair', icon: 'pen' },
  { id: 'hand', label: 'Hand', shortcut: 'H', cursor: 'grab', icon: 'hand' },
  { id: 'zoom', label: 'Zoom', shortcut: 'Z', cursor: 'zoom-in', icon: 'zoom' },
  { id: 'text', label: 'Type', shortcut: 'T', cursor: 'text', icon: 'text' }
];

export function toolById(id: ToolId): Tool {
  const tool = tools.find((t) => t.id === id);
  // the id type keeps this unreachable, the fallback is there so callers
  // never have to deal with undefined
  return tool ?? tools[0];
}
