import { get } from 'svelte/store';
import { closeProject, dirty, loadProject, markSaved, project } from '$lib/project/store';
import { PROJECT_EXTENSION, parseProject, projectFileName, serializeProject } from '$lib/project/serialize';
import {
  cancelAutosave,
  flushAutosave,
  isStoredLocally,
  listRecents,
  loadProjectLocal,
  scheduleAutosave,
  setLastOpenedId,
  touchRecent,
  type RecentProject
} from '$lib/project/persistence';
import { restoreSources } from '$lib/media/sources';
import { downloadBlob } from '$lib/export/download';
import { addToast, dialog, projectHandle, sourceMedia } from '$lib/stores/app';
import { preferences } from '$lib/stores/preferences';
import type { Project } from '$lib/project/types';

const PICKER_TYPES: FilePickerAcceptType[] = [
  { description: 'brainCUT project', accept: { 'application/json': [PROJECT_EXTENSION] } }
];

type SavePicker = (opts: { suggestedName?: string; types?: FilePickerAcceptType[]; id?: string }) => Promise<FileSystemFileHandle>;

function savePicker(): SavePicker | null {
  const w = window as Window & { showSaveFilePicker?: SavePicker };
  return typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(w) : null;
}

function aborted(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

function message(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

async function writeToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

// the project goes back to the file it came from, or a fresh one is picked.
// without the file system access api the browser downloads it instead
async function write(p: Project, askForFile: boolean): Promise<boolean> {
  const text = serializeProject(p);
  let handle = askForFile ? null : get(projectHandle);
  try {
    if (!handle) {
      const picker = savePicker();
      if (picker) {
        handle = await picker({ suggestedName: projectFileName(p), types: PICKER_TYPES, id: 'braincut-project' });
      } else {
        downloadBlob(new Blob([text], { type: 'application/json' }), projectFileName(p));
        return true;
      }
    }
    await writeToHandle(handle, text);
    projectHandle.set(handle);
    return true;
  } catch (e) {
    if (aborted(e)) return false;
    addToast(`Could not save the project: ${message(e, 'the file could not be written')}`, 'error', 6000);
    return false;
  }
}

async function afterSave(p: Project): Promise<void> {
  markSaved();
  await touchRecent(p).catch(() => {});
  addToast(`Saved ${p.name}`, 'success', 2000);
}

export async function saveProject(): Promise<void> {
  const p = get(project);
  if (!p) return;
  if (await write(p, false)) await afterSave(p);
}

export async function saveProjectAs(): Promise<void> {
  const p = get(project);
  if (!p) return;
  if (await write(p, true)) await afterSave(p);
}

// one place every open path ends up: loading, hooking the media back up,
// remembering it for the welcome screen
async function open(p: Project, handle: FileSystemFileHandle | null): Promise<void> {
  loadProject(p);
  projectHandle.set(handle);
  sourceMedia.set(null);
  await restoreSources(p);
  await touchRecent(p).catch(() => {});
  await setLastOpenedId(p.id).catch(() => {});
  addToast(`Opened ${p.name}`, 'success', 2000);
}

// a project file dropped on the window lands here
export async function openProjectFromFile(file: File): Promise<void> {
  if (!confirmDiscard()) return;
  await openFromFile(file, null);
}

async function openFromFile(file: File, handle: FileSystemFileHandle | null): Promise<void> {
  let p: Project;
  try {
    p = parseProject(await file.text());
  } catch (e) {
    addToast(message(e, `${file.name} is not a brainCUT project`), 'error', 6000);
    return;
  }
  await open(p, handle);
}

function inputFallback(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${PROJECT_EXTENSION},.json`;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    document.body.append(input);
    input.click();
  });
}

// work is only really lost when the browser has no copy of it either.
// with autosave on, a stored project comes back from the recents list, so
// asking about it is noise
export function unsavedWork(): boolean {
  const p = get(project);
  if (!p || !get(dirty)) return false;
  return !(get(preferences).autoSave && isStoredLocally(p.id));
}

export function confirmDiscard(): boolean {
  if (!unsavedWork()) return true;
  return confirm('The open project has unsaved changes. Continue without saving them?');
}

export async function openProjectFile(): Promise<void> {
  if (!confirmDiscard()) return;
  try {
    if ('showOpenFilePicker' in window) {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: PICKER_TYPES, id: 'braincut-project' });
      if (!handle) return;
      await openFromFile(await handle.getFile(), handle);
      return;
    }
    const file = await inputFallback();
    if (file) await openFromFile(file, null);
  } catch (e) {
    if (aborted(e)) return;
    addToast(`Could not open the project: ${message(e, 'the file could not be read')}`, 'error', 6000);
  }
}

export async function openRecent(id: string): Promise<void> {
  if (!confirmDiscard()) return;
  let p: Project | null = null;
  try {
    p = await loadProjectLocal(id);
  } catch (e) {
    addToast(`Could not open the project: ${message(e, 'the stored copy is damaged')}`, 'error', 6000);
    return;
  }
  if (!p) {
    addToast('That project is no longer stored in this browser', 'warning', 5000);
    return;
  }
  await open(p, null);
}

export function newProject(): void {
  if (!confirmDiscard()) return;
  dialog.set({ kind: 'new-project' });
}

export async function closeCurrentProject(): Promise<void> {
  if (!get(project)) return;
  if (!confirmDiscard()) return;
  // whatever autosave still holds lands before the project goes away
  if (get(preferences).autoSave) await flushAutosave();
  else cancelAutosave();
  closeProject();
  projectHandle.set(null);
  sourceMedia.set(null);
}

export function recentProjects(): Promise<RecentProject[]> {
  return listRecents().catch(() => []);
}

// what the editor page keeps running while it is up: autosave after every
// change, the handle dropped when another project takes over, a warning
// before the tab closes on unsaved work
export function installProjectLifecycle(): () => void {
  let currentId = get(project)?.id ?? null;
  const unsubscribe = project.subscribe((p) => {
    const id = p?.id ?? null;
    if (id !== currentId) {
      currentId = id;
      // a project loaded by someone else (new project dialog, recents) has
      // no file yet. openFromFile sets its handle right after loading
      projectHandle.set(null);
    }
    if (p && get(preferences).autoSave) scheduleAutosave(p);
  });

  // an import, a conversion or an export running is never a reason to hold
  // the tab: only changes that would be gone for good are
  function onBeforeUnload(e: BeforeUnloadEvent) {
    void flushAutosave();
    if (!unsavedWork()) return;
    e.preventDefault();
    e.returnValue = '';
  }
  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', onBeforeUnload);
    void flushAutosave();
  };
}
