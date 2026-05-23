import { describe, expect, it } from 'vitest';
import { produceWithPatches } from 'immer';
import { History } from './history';

interface State {
  items: number[];
  name: string;
}

function apply(h: History<State>, state: State, label: string, recipe: (d: State) => void): State {
  const [next, patches, inverse] = produceWithPatches(state, recipe);
  h.push(label, patches, inverse);
  return next;
}

describe('History', () => {
  it('undoes and redoes with labels', () => {
    const h = new History<State>();
    let s: State = { items: [], name: 'a' };
    s = apply(h, s, 'add 1', (d) => void d.items.push(1));
    s = apply(h, s, 'rename', (d) => void (d.name = 'b'));
    expect(h.canUndo).toBe(true);
    expect(h.undoLabel).toBe('rename');
    expect(h.labels).toEqual(['add 1', 'rename']);

    const u1 = h.undo(s)!;
    expect(u1.label).toBe('rename');
    expect(u1.state).toEqual({ items: [1], name: 'a' });
    expect(h.redoLabel).toBe('rename');
    const u2 = h.undo(u1.state)!;
    expect(u2.state).toEqual({ items: [], name: 'a' });
    expect(h.canUndo).toBe(false);
    expect(h.undo(u2.state)).toBeNull();

    const r = h.redo(u2.state)!;
    expect(r.state.items).toEqual([1]);
    expect(h.index).toBe(1);
  });

  it('drops the redo branch on a new push', () => {
    const h = new History<State>();
    let s: State = { items: [], name: 'a' };
    s = apply(h, s, 'one', (d) => void d.items.push(1));
    s = h.undo(s)!.state;
    s = apply(h, s, 'two', (d) => void d.items.push(2));
    expect(h.canRedo).toBe(false);
    expect(h.labels).toEqual(['two']);
    expect(s.items).toEqual([2]);
  });

  it('ignores empty changes and caps the length', () => {
    const h = new History<State>(3);
    let s: State = { items: [], name: 'a' };
    s = apply(h, s, 'nothing', () => {});
    expect(h.length).toBe(0);
    for (let i = 0; i < 5; i++) s = apply(h, s, `add ${i}`, (d) => void d.items.push(i));
    expect(h.labels).toEqual(['add 2', 'add 3', 'add 4']);
    while (h.canUndo) s = h.undo(s)!.state;
    expect(s.items).toEqual([0, 1]);
  });

  it('seeks to an index', () => {
    const h = new History<State>();
    let s: State = { items: [], name: 'a' };
    for (let i = 0; i < 4; i++) s = apply(h, s, `add ${i}`, (d) => void d.items.push(i));
    s = h.seek(s, 1);
    expect(s.items).toEqual([0]);
    s = h.seek(s, 3);
    expect(s.items).toEqual([0, 1, 2]);
    h.clear();
    expect(h.snapshot()).toEqual({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null, entries: [], index: 0 });
  });
});
