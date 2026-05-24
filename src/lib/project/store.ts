import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import { freeze, produce, produceWithPatches, type Patch } from 'immer';
import { History, type HistoryState } from './history';
import type { Clip, Id, MediaItem, Project, Sequence, Track } from './types';
import { linkedClips } from './ops';
import { selection } from '$lib/stores/app';

export const project: Writable<Project | null> = writable(null);

export const activeSequence: Readable<Sequence | null> = derived(project, ($p) => {
  if (!$p) return null;
  return $p.sequences.find((s) => s.id === $p.activeSequenceId) ?? $p.sequences[0] ?? null;
});

export const mediaById: Readable<Map<Id, MediaItem>> = derived(project, ($p) => {
  const map = new Map<Id, MediaItem>();
  if ($p) for (const m of $p.media) map.set(m.id, m);
  return map;
});

const undoStack = new History<Project>(200);
const historyState = writable<HistoryState>(undoStack.snapshot());
export const history: Readable<HistoryState> = { subscribe: historyState.subscribe };

// every change that matters for the file bumps the revision; saving remembers it
const revision = writable(0);
const savedRevision = writable(0);
export const dirty: Readable<boolean> = derived([revision, savedRevision], ([$r, $s]) => $r !== $s);

function bump(): void {
  revision.update((r) => r + 1);
}

function syncHistory(): void {
  historyState.set(undoStack.snapshot());
}

// a preview in flight: the state before it and what has been applied since
let previewBase: Project | null = null;

export function edit(label: string, recipe: (draft: Project) => void): void {
  if (previewBase) commitPreview(label);
  const current = get(project);
  if (!current) return;
  const [next, patches, inverse] = produceWithPatches(current, (draft) => {
    recipe(draft);
    draft.modifiedAt = Date.now();
  });
  // a recipe that changed nothing still touched modifiedAt, skip those
  if (!patches.some((p) => p.path.length !== 1 || p.path[0] !== 'modifiedAt')) return;
  undoStack.push(label, patches, inverse);
  project.set(next);
  bump();
  syncHistory();
}

export function editSequence(label: string, recipe: (seq: Sequence, draft: Project) => void): void {
  edit(label, (draft) => {
    const seq = draft.sequences.find((s) => s.id === draft.activeSequenceId) ?? draft.sequences[0];
    if (seq) recipe(seq, draft);
  });
}

// live drags: apply on top of the current state without touching history.
// each call stacks on the previous preview, so a drag either writes absolute
// values captured at its start or incremental deltas, both work
export function preview(recipe: (draft: Project) => void): void {
  const current = get(project);
  if (!current) return;
  previewBase ??= current;
  project.set(produce(current, recipe));
}

function diffPatches(base: Project, next: Project): { patches: Patch[]; inverse: Patch[] } {
  // structural sharing means an unchanged branch keeps its reference, so a
  // shallow walk finds what moved without a deep diff
  const patches: Patch[] = [];
  const inverse: Patch[] = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]) as Set<keyof Project>;
  for (const key of keys) {
    if (base[key] === next[key]) continue;
    if (key === 'sequences' && base.sequences.length === next.sequences.length) {
      base.sequences.forEach((seq, i) => {
        if (seq === next.sequences[i]) return;
        patches.push({ op: 'replace', path: ['sequences', i], value: next.sequences[i] });
        inverse.push({ op: 'replace', path: ['sequences', i], value: seq });
      });
      continue;
    }
    patches.push({ op: 'replace', path: [key], value: next[key] });
    inverse.push({ op: 'replace', path: [key], value: base[key] });
  }
  return { patches, inverse };
}

export function commitPreview(label: string): void {
  const base = previewBase;
  previewBase = null;
  const current = get(project);
  if (!base || !current || base === current) return;
  const stamped = produce(current, (draft) => {
    draft.modifiedAt = Date.now();
  });
  const { patches, inverse } = diffPatches(base, stamped);
  undoStack.push(label, patches, inverse);
  project.set(stamped);
  bump();
  syncHistory();
}

export function cancelPreview(): void {
  const base = previewBase;
  previewBase = null;
  if (base) project.set(base);
}

export function undo(): void {
  if (previewBase) cancelPreview();
  const current = get(project);
  if (!current) return;
  const result = undoStack.undo(current);
  if (!result) return;
  project.set(result.state);
  bump();
  syncHistory();
}

export function redo(): void {
  if (previewBase) cancelPreview();
  const current = get(project);
  if (!current) return;
  const result = undoStack.redo(current);
  if (!result) return;
  project.set(result.state);
  bump();
  syncHistory();
}

// the history panel: jump to any step
export function seekHistory(index: number): void {
  if (previewBase) cancelPreview();
  const current = get(project);
  if (!current) return;
  project.set(undoStack.seek(current, index));
  bump();
  syncHistory();
}

export function loadProject(p: Project): void {
  previewBase = null;
  undoStack.clear();
  // frozen like everything immer produces, so a stray mutation fails loudly
  project.set(freeze(p, true));
  selection.set([]);
  const r = get(revision);
  savedRevision.set(r);
  syncHistory();
}

export function closeProject(): void {
  previewBase = null;
  undoStack.clear();
  project.set(null);
  selection.set([]);
  savedRevision.set(get(revision));
  syncHistory();
}

// which sequence is open is saved in the file but is not an undo step
export function setActiveSequence(sequenceId: Id): void {
  const current = get(project);
  if (!current || current.activeSequenceId === sequenceId) return;
  if (!current.sequences.some((s) => s.id === sequenceId)) return;
  project.set(produce(current, (draft) => {
    draft.activeSequenceId = sequenceId;
  }));
  selection.set([]);
  bump();
}

export function markSaved(): void {
  savedRevision.set(get(revision));
}

export function findClip(p: Project, clipId: Id): { clip: Clip; track: Track; sequence: Sequence } | null {
  for (const sequence of p.sequences) {
    for (const track of sequence.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { clip, track, sequence };
    }
  }
  return null;
}

// selection follows links: picking a video clip picks its audio too
export function selectClips(ids: Id[], mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
  const seq = get(activeSequence);
  const expanded = new Set<Id>();
  for (const cid of ids) {
    expanded.add(cid);
    if (seq) for (const linked of linkedClips(seq, cid)) expanded.add(linked.id);
  }
  if (mode === 'replace') {
    selection.set([...expanded]);
    return;
  }
  const current = new Set(get(selection));
  for (const cid of expanded) {
    if (mode === 'add' || !current.has(cid)) current.add(cid);
    else current.delete(cid);
  }
  selection.set([...current]);
}

export function clearSelection(): void {
  selection.set([]);
}

export function selectedClips(): Clip[] {
  const seq = get(activeSequence);
  if (!seq) return [];
  const ids = new Set(get(selection));
  const out: Clip[] = [];
  for (const track of seq.tracks) for (const clip of track.clips) if (ids.has(clip.id)) out.push(clip);
  return out;
}
