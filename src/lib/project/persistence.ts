import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import type { Id, Project } from './types';
import { normalizeProject } from './serialize';

export interface RecentProject {
  id: Id;
  name: string;
  modifiedAt: number;
  sequenceCount: number;
}

// project ids whose state made it into indexeddb. with autosave on, a tab
// that closes on one of these loses nothing: it comes back from the recents
const stored = new Set<Id>();

export function isStoredLocally(id: Id): boolean {
  return stored.has(id);
}

const MAX_RECENTS = 20;
const RECENTS_KEY = 'recents';
const LAST_OPENED_KEY = 'last-opened';

// tests and server-side rendering have no indexeddb, everything here turns
// into a no-op there rather than throwing at import time
const available = typeof indexedDB !== 'undefined';
let store: UseStore | null = null;

function db(): UseStore | null {
  if (!available) return null;
  store ??= createStore('braincut', 'braincut');
  return store;
}

function projectKey(id: Id): string {
  return `project:${id}`;
}

export async function saveProjectLocal(p: Project): Promise<void> {
  const s = db();
  if (!s) return;
  // strip immer's frozen proxies and anything structured clone would choke on
  await set(projectKey(p.id), JSON.parse(JSON.stringify(p)), s);
  stored.add(p.id);
  await touchRecent(p);
}

export async function loadProjectLocal(id: Id): Promise<Project | null> {
  const s = db();
  if (!s) return null;
  const raw = await get<unknown>(projectKey(id), s);
  if (raw === undefined) return null;
  stored.add(id);
  return normalizeProject(raw);
}

export async function deleteProjectLocal(id: Id): Promise<void> {
  const s = db();
  if (!s) return;
  await del(projectKey(id), s);
  stored.delete(id);
  const recents = (await listRecents()).filter((r) => r.id !== id);
  await set(RECENTS_KEY, recents, s);
  if ((await getLastOpenedId()) === id) await setLastOpenedId(null);
}

export async function listRecents(): Promise<RecentProject[]> {
  const s = db();
  if (!s) return [];
  const recents = await get<RecentProject[]>(RECENTS_KEY, s);
  return Array.isArray(recents) ? recents : [];
}

export async function touchRecent(p: Project): Promise<void> {
  const s = db();
  if (!s) return;
  const entry: RecentProject = { id: p.id, name: p.name, modifiedAt: p.modifiedAt, sequenceCount: p.sequences.length };
  const others = (await listRecents()).filter((r) => r.id !== p.id);
  await set(RECENTS_KEY, [entry, ...others].slice(0, MAX_RECENTS), s);
}

export async function getLastOpenedId(): Promise<Id | null> {
  const s = db();
  if (!s) return null;
  return (await get<Id>(LAST_OPENED_KEY, s)) ?? null;
}

export async function setLastOpenedId(id: Id | null): Promise<void> {
  const s = db();
  if (!s) return;
  if (id === null) await del(LAST_OPENED_KEY, s);
  else await set(LAST_OPENED_KEY, id, s);
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: Project | null = null;

// coalesces a burst of edits into one write. returns a function that drops
// the scheduled save, for closing a project without persisting it
export function scheduleAutosave(p: Project, delay = 1500): () => void {
  pending = p;
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    const toSave = pending;
    pending = null;
    if (toSave) void saveProjectLocal(toSave);
  }, delay);
  return cancelAutosave;
}

export function cancelAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  pending = null;
}

// write whatever is still waiting, for page unload
export async function flushAutosave(): Promise<void> {
  const toSave = pending;
  cancelAutosave();
  if (toSave) await saveProjectLocal(toSave);
}
