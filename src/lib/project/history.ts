import { applyPatches, enablePatches, type Patch } from 'immer';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  entries: string[];
  index: number;
}

// undo as a list of immer patches rather than snapshots: a project with a
// few thousand clips would otherwise cost a copy per edit
export class History<T extends object> {
  private entries: HistoryEntry[] = [];
  // number of entries that are applied; entries beyond it are redo
  private cursor = 0;

  constructor(private readonly limit = 200) {}

  push(label: string, patches: Patch[], inverse: Patch[]): void {
    if (patches.length === 0) return;
    this.entries.length = this.cursor;
    this.entries.push({ label, patches, inverse });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    this.cursor = this.entries.length;
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length;
  }

  get undoLabel(): string | null {
    return this.canUndo ? this.entries[this.cursor - 1].label : null;
  }

  get redoLabel(): string | null {
    return this.canRedo ? this.entries[this.cursor].label : null;
  }

  get labels(): string[] {
    return this.entries.map((e) => e.label);
  }

  get index(): number {
    return this.cursor;
  }

  get length(): number {
    return this.entries.length;
  }

  undo(state: T): { state: T; label: string } | null {
    if (!this.canUndo) return null;
    const entry = this.entries[--this.cursor];
    return { state: applyPatches(state, entry.inverse), label: entry.label };
  }

  redo(state: T): { state: T; label: string } | null {
    if (!this.canRedo) return null;
    const entry = this.entries[this.cursor++];
    return { state: applyPatches(state, entry.patches), label: entry.label };
  }

  // jump to an absolute position, the way a history panel does it
  seek(state: T, index: number): T {
    let current = state;
    while (this.cursor > index) current = this.undo(current)?.state ?? current;
    while (this.cursor < index) current = this.redo(current)?.state ?? current;
    return current;
  }

  clear(): void {
    this.entries = [];
    this.cursor = 0;
  }

  snapshot(): HistoryState {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoLabel,
      redoLabel: this.redoLabel,
      entries: this.labels,
      index: this.cursor
    };
  }
}
