<script lang="ts">
  import { get } from 'svelte/store';
  import Dialog from '../Dialog.svelte';
  import Field from '../Field.svelte';
  import NumberField from '../NumberField.svelte';
  import SelectField from '../SelectField.svelte';
  import ToggleField from '../ToggleField.svelte';
  import { preferences, type Preferences } from '$lib/stores/preferences';
  import { addToast } from '$lib/stores/app';
  import { edit, project } from '$lib/project/store';
  import { transitionDefs } from '$lib/engine/transitions/registry';
  import { remove, estimateQuota, formatBytes } from '$lib/media/opfs';
  import { forgetPeaks } from '$lib/media/waveform';
  import { deleteProjectLocal } from '$lib/project/persistence';

  let { onclose }: { onclose: () => void } = $props();

  const videoTransitions = transitionDefs.filter((d) => d.kind === 'video').map((d) => ({ value: d.id, label: d.name }));
  const audioTransitions = transitionDefs.filter((d) => d.kind === 'audio').map((d) => ({ value: d.id, label: d.name }));
  const qualityOptions = [
    { value: '1', label: 'Full' },
    { value: '0.5', label: 'Half' },
    { value: '0.25', label: 'Quarter' },
    { value: '0.125', label: 'Eighth' }
  ];
  const hardwareOptions = [
    { value: 'no-preference', label: 'Let the browser choose' },
    { value: 'prefer-hardware', label: 'Prefer hardware' },
    { value: 'prefer-software', label: 'Prefer software' }
  ];
  const timecodeOptions = [
    { value: 'timecode', label: 'Timecode (HH:MM:SS:FF)' },
    { value: 'frames', label: 'Frames' },
    { value: 'seconds', label: 'Seconds' }
  ];

  function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    preferences.update((p) => ({ ...p, [key]: value }));
  }

  // what the browser is holding for the editor, read where it actually lies:
  // the databases the project and media modules write, and the origin private
  // file system the proxies and converted copies go to
  type GroupKey = 'projects' | 'sources' | 'peaks' | 'proxies' | 'converted';

  interface Group {
    key: GroupKey;
    label: string;
    hint: string;
    count: number;
    bytes: number;
    // nothing can make this again once it is gone
    permanent: boolean;
    idb?: { db: string; store: string; keys: string[] };
    files?: string[];
  }

  let groups = $state<Group[]>([]);
  let chosen = $state<Record<GroupKey, boolean>>({ projects: false, sources: false, peaks: true, proxies: true, converted: true });
  let usage = $state<string | null>(null);
  let scanning = $state(true);
  let clearing = $state(false);

  const picked = $derived(groups.filter((g) => chosen[g.key] && g.count > 0));
  const total = $derived(groups.reduce((sum, g) => sum + g.bytes, 0));

  // opened without a version and with any upgrade thrown away, so counting
  // what is stored never brings a database or a store into being: the modules
  // that own them create their own on first write
  async function existingDb(name: string): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return null;
    if (indexedDB.databases) {
      const known = await indexedDB.databases().catch(() => [] as IDBDatabaseInfo[]);
      if (!known.some((d) => d.name === name)) return null;
    }
    return new Promise((resolve) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }

  function readStore(db: IDBDatabase | null, store: string): Promise<[string, unknown][]> {
    if (!db || !db.objectStoreNames.contains(store)) return Promise.resolve([]);
    return new Promise((resolve) => {
      const out: [string, unknown][] = [];
      try {
        const request = db.transaction(store, 'readonly').objectStore(store).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve(out);
          out.push([String(cursor.key), cursor.value]);
          cursor.continue();
        };
        request.onerror = () => resolve(out);
      } catch {
        resolve(out);
      }
    });
  }

  function deleteKeys(db: IDBDatabase, store: string, keys: string[]): Promise<void> {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(store, 'readwrite');
        const target = tx.objectStore(store);
        for (const key of keys) target.delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async function opfsFiles(folder: string): Promise<{ key: string; bytes: number }[]> {
    const out: { key: string; bytes: number }[] = [];
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return out;
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(folder);
      for await (const entry of dir.values()) {
        if (entry.kind !== 'file') continue;
        out.push({ key: `${folder}/${entry.name}`, bytes: (await entry.getFile()).size });
      }
    } catch {
      // the folder is simply not there yet
    }
    return out;
  }

  function byteSize(value: unknown): number {
    if (value instanceof Blob) return value.size;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    return 0;
  }

  // every module makes its own key-value store, and where it ends up is up to
  // whichever one wrote first, so the stores are found by looking through the
  // databases that exist rather than by assuming a name for each
  const DB_NAMES = ['braincut', 'braincut-media', 'braincut-peaks', 'braincut-files'];

  async function openDbs(): Promise<IDBDatabase[]> {
    if (typeof indexedDB === 'undefined') return [];
    let names = DB_NAMES;
    if (indexedDB.databases) {
      const known = await indexedDB.databases().catch(() => [] as IDBDatabaseInfo[]);
      names = known.map((d) => d.name).filter((n): n is string => !!n && n.startsWith('braincut'));
    }
    const out: IDBDatabase[] = [];
    for (const name of names) {
      const db = await existingDb(name);
      if (db) out.push(db);
    }
    return out;
  }

  function dbWith(dbs: IDBDatabase[], store: string): IDBDatabase | null {
    return dbs.find((db) => db.objectStoreNames.contains(store)) ?? null;
  }

  async function scan() {
    scanning = true;
    const dbs = await openDbs();
    const projectDb = dbWith(dbs, 'braincut');
    const sourceDb = dbWith(dbs, 'sources');
    const peaksDb = dbWith(dbs, 'peaks');
    const filesDb = dbWith(dbs, 'files');
    const projects = (await readStore(projectDb, 'braincut')).filter(([key]) => key.startsWith('project:'));
    // a record holds a copy of the file when one was worth keeping, the id:
    // keys next to it are only pointers and cost nothing
    const sources = (await readStore(sourceDb, 'sources')).filter(([key]) => !key.startsWith('id:'));
    const peaks = await readStore(peaksDb, 'peaks');
    const stored = await readStore(filesDb, 'files');
    const fallback = (folder: string) => stored.filter(([key]) => key.startsWith(`${folder}/`));
    const proxies = [...(await opfsFiles('proxy')), ...fallback('proxy').map(([key, value]) => ({ key, bytes: byteSize(value) }))];
    const converted = [...(await opfsFiles('converted')), ...fallback('converted').map(([key, value]) => ({ key, bytes: byteSize(value) }))];

    groups = [
      {
        key: 'projects',
        label: 'Projects',
        hint: 'Autosaved copies of the projects you opened here',
        count: projects.length,
        bytes: projects.reduce((sum, [, value]) => sum + JSON.stringify(value).length, 0),
        permanent: true,
        idb: projectDb ? { db: projectDb.name, store: 'braincut', keys: projects.map(([key]) => key) } : undefined
      },
      {
        key: 'sources',
        label: 'Source copies',
        hint: 'Copies of imported files, so reopening a project needs no permission',
        count: sources.filter(([, value]) => byteSize((value as { file?: unknown } | null)?.file) > 0).length,
        bytes: sources.reduce((sum, [, value]) => sum + byteSize((value as { file?: unknown } | null)?.file), 0),
        permanent: true,
        idb: sourceDb ? { db: sourceDb.name, store: 'sources', keys: (await readStore(sourceDb, 'sources')).map(([key]) => key) } : undefined
      },
      {
        key: 'peaks',
        label: 'Waveforms',
        hint: 'Computed again the next time a clip shows one',
        count: peaks.length,
        bytes: peaks.reduce((sum, [, value]) => sum + byteSize(value), 0),
        permanent: false,
        idb: peaksDb ? { db: peaksDb.name, store: 'peaks', keys: peaks.map(([key]) => key) } : undefined
      },
      {
        key: 'proxies',
        label: 'Proxies',
        hint: 'Small stand-ins for playback, made again from the project panel',
        count: proxies.length,
        bytes: proxies.reduce((sum, f) => sum + f.bytes, 0),
        permanent: false,
        files: proxies.map((f) => f.key)
      },
      {
        key: 'converted',
        label: 'Converted copies',
        hint: 'Files the browser could not decode, converted again when needed',
        count: converted.length,
        bytes: converted.reduce((sum, f) => sum + f.bytes, 0),
        permanent: false,
        files: converted.map((f) => f.key)
      }
    ];
    for (const db of dbs) db.close();
    const quota = await estimateQuota().catch(() => ({ usage: 0, quota: Infinity }));
    usage = quota.usage > 0 ? formatBytes(quota.usage) : null;
    scanning = false;
  }

  void scan();

  function confirmText(): string {
    const what = picked.map((g) => `${g.count} ${g.label.toLowerCase()}`).join(', ');
    const permanent = picked.filter((g) => g.permanent);
    if (permanent.length) {
      const names = permanent.map((g) => g.label.toLowerCase()).join(' and ');
      return `Delete ${what}?\n\nNothing can bring ${names} back. Save any project you still want to a file first. Files on your disk are never touched.`;
    }
    return `Delete ${what}?\n\nThey are made again the next time they are needed. Files on your disk are never touched.`;
  }

  async function clearChosen() {
    if (!picked.length || !confirm(confirmText())) return;
    clearing = true;
    const cleared = picked.map((g) => g.key);
    try {
      for (const group of picked) {
        if (group.key === 'projects') {
          for (const key of group.idb?.keys ?? []) await deleteProjectLocal(key.slice('project:'.length)).catch(() => {});
        } else if (group.idb?.keys.length) {
          const db = await existingDb(group.idb.db);
          if (db) {
            await deleteKeys(db, group.idb.store, group.idb.keys);
            db.close();
          }
        }
        for (const key of group.files ?? []) await remove(key).catch(() => {});
      }
      const p = get(project);
      if (cleared.includes('peaks') && p) {
        // the drawn waveforms come from a cache in memory, not from the store
        await Promise.all(p.media.map((m) => forgetPeaks(m.id)));
      }
      if (p && (cleared.includes('proxies') || cleared.includes('converted'))) {
        // the project still points at files that just went away
        edit('clear cached data', (draft) => {
          for (const m of draft.media) {
            if (cleared.includes('proxies')) m.proxy = null;
            if (cleared.includes('converted')) m.converted = null;
          }
        });
      }
      addToast(`Cleared ${picked.map((g) => g.label.toLowerCase()).join(', ')}`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not clear the stored data', 'error');
    } finally {
      clearing = false;
      // say what is left, measured again rather than assumed
      await scan();
    }
  }
</script>

<Dialog title="Preferences" description="How the editor behaves. Everything is stored locally." width={520} {onclose}>
  <div class="prefs">
    <h3 class="section">Editing</h3>
    <Field label="Still image duration" hint="How long a photo or a title stays on screen when it lands on the timeline">
      <NumberField value={$preferences.stillImageDuration} min={0.1} max={600} step={0.5} precision={1} unit=" s" label="Still image duration" onchange={(v) => set('stillImageDuration', v)} />
    </Field>
    <p class="help">Seconds a photo, title or color matte gets when it lands on the timeline.</p>
    <Field label="Transition duration">
      <NumberField value={$preferences.defaultTransitionDuration} min={0.05} max={30} step={0.1} precision={2} unit=" s" label="Default transition duration" onchange={(v) => set('defaultTransitionDuration', v)} />
    </Field>
    <Field label="Video transition">
      <SelectField value={$preferences.defaultVideoTransition} options={videoTransitions} label="Default video transition" onchange={(v) => set('defaultVideoTransition', v)} />
    </Field>
    <Field label="Audio transition">
      <SelectField value={$preferences.defaultAudioTransition} options={audioTransitions} label="Default audio transition" onchange={(v) => set('defaultAudioTransition', v)} />
    </Field>
    <p class="help">The defaults Ctrl+D and Ctrl+Shift+D drop on the cut nearest the playhead.</p>
    <Field label="Snapping">
      <ToggleField value={$preferences.snapping} label="Snapping" onchange={(v) => set('snapping', v)} />
    </Field>
    <p class="help">Clip edges, the playhead and markers pull dragged clips onto them. S toggles it while editing.</p>
    <Field label="Timecode format">
      <SelectField value={$preferences.timecodeFormat} options={timecodeOptions} label="Timecode format" onchange={(v) => set('timecodeFormat', v as Preferences['timecodeFormat'])} />
    </Field>

    <h3 class="section">Playback</h3>
    <Field label="Preview quality">
      <SelectField value={String($preferences.previewQuality)} options={qualityOptions} label="Preview quality" onchange={(v) => set('previewQuality', Number(v))} />
    </Field>
    <p class="help">The size the program monitor renders at. Quarter is plenty on most screens and keeps 4K playback smooth. Exports are always full size.</p>
    <Field label="Hardware decoding">
      <SelectField value={$preferences.hardwareAcceleration} options={hardwareOptions} label="Hardware acceleration" onchange={(v) => set('hardwareAcceleration', v as Preferences['hardwareAcceleration'])} />
    </Field>
    <p class="help">Which decoder the browser is asked for. Software is slower but works with more files; the change applies to files opened from now on.</p>
    <Field label="Audio scrubbing">
      <ToggleField value={$preferences.audioScrubbing} label="Audio scrubbing" onchange={(v) => set('audioScrubbing', v)} />
    </Field>
    <p class="help">Hear short bits of sound while dragging the playhead.</p>
    <Field label="Use proxies">
      <ToggleField value={$preferences.useProxies} label="Use proxies" onchange={(v) => set('useProxies', v)} />
    </Field>
    <p class="help">Play the smaller proxy copies where they exist instead of the originals. Make them from the project panel.</p>

    <h3 class="section">Timeline</h3>
    <Field label="Thumbnails">
      <ToggleField value={$preferences.showThumbnails} label="Show thumbnails" onchange={(v) => set('showThumbnails', v)} />
    </Field>
    <Field label="Waveforms">
      <ToggleField value={$preferences.showWaveforms} label="Show waveforms" onchange={(v) => set('showWaveforms', v)} />
    </Field>
    <p class="help">Pictures on video clips and waveforms on audio clips. Turn them off on a slow machine.</p>
    <Field label="Thumbnail size">
      <NumberField value={$preferences.thumbnailSize} min={64} max={240} step={8} precision={0} unit=" px" label="Thumbnail size" onchange={(v) => set('thumbnailSize', v)} />
    </Field>
    <p class="help">Width of the tiles in the project panel's icon view.</p>

    <h3 class="section">Project</h3>
    <Field label="Autosave">
      <ToggleField value={$preferences.autoSave} label="Autosave" onchange={(v) => set('autoSave', v)} />
    </Field>
    <p class="help">Keep a copy of the open project in the browser after every change, so a closed tab loses nothing.</p>

    <h3 class="section">Converter</h3>
    <Field label="Mirror URL">
      <input
        class="text"
        value={$preferences.ffmpegMirror}
        spellcheck="false"
        placeholder="Empty: converting is off"
        aria-label="Converter mirror URL"
        onchange={(e) => set('ffmpegMirror', e.currentTarget.value.trim())} />
    </Field>
    <p class="help">
      Files the browser can't decode are converted with a small tool fetched from this address the first time it is needed, then cached for offline use.
      It is the only thing the editor ever downloads. Leave it empty to disable converting entirely.
    </p>

    <h3 class="section">Storage</h3>
    <div class="storage">
      {#if scanning && !groups.length}
        <p class="empty">Looking at what is stored…</p>
      {:else}
        <table class="table">
          <tbody>
            {#each groups as group (group.key)}
              <tr class:none={group.count === 0}>
                <td class="pick">
                  <input
                    type="checkbox"
                    id="clear-{group.key}"
                    checked={chosen[group.key]}
                    disabled={group.count === 0 || clearing}
                    onchange={(e) => (chosen = { ...chosen, [group.key]: e.currentTarget.checked })} />
                </td>
                <th scope="row">
                  <label for="clear-{group.key}">{group.label}</label>
                  {#if group.permanent}<span class="tag" title="Nothing can make these again">kept</span>{/if}
                  <span class="what">{group.hint}</span>
                </th>
                <td class="count">{group.count === 0 ? 'none' : `${group.count} item${group.count === 1 ? '' : 's'}`}</td>
                <td class="size">{group.bytes > 0 ? formatBytes(group.bytes) : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <div class="row">
          <button class="dialog-btn" onclick={clearChosen} disabled={clearing || scanning || picked.length === 0}>
            {clearing ? 'Clearing…' : 'Clear selected'}
          </button>
          <span class="usage">
            {formatBytes(total)} listed{usage ? `, ${usage} in this browser` : ''}
          </span>
        </div>
      {/if}
    </div>
    <p class="help">
      Everything the editor keeps in this browser, and how big it is. Tick what should go: projects and source copies are kept for you and
      nothing can make them again, the rest is rebuilt when it is needed. Your original files on disk are never touched.
    </p>
  </div>
  {#snippet footer()}
    <button class="dialog-btn primary" onclick={onclose}>Done</button>
  {/snippet}
</Dialog>

<style>
  .prefs {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0 -8px;
  }

  .section {
    margin: 12px 8px 4px;
    font-family: var(--font-editor);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
  }

  .section:first-child {
    margin-top: 0;
  }

  .help {
    padding: 0 8px 6px 124px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .text {
    width: 100%;
    padding: 3px 6px;
    font-family: var(--font-editor);
    font-size: 11px;
    line-height: 16px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid transparent;
    border-bottom-color: var(--border);
    outline: none;
  }

  .text:focus {
    border-color: var(--accent);
  }

  .text::placeholder {
    color: var(--text-muted);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .storage {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px 8px 4px;
  }

  .empty {
    font-size: 11px;
    color: var(--text-muted);
  }

  .table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }

  .table tr {
    border-bottom: 1px solid var(--border);
  }

  .table tr.none {
    opacity: 0.5;
  }

  .table th,
  .table td {
    padding: 4px 6px 4px 0;
    text-align: left;
    font-weight: 400;
    vertical-align: baseline;
  }

  .pick {
    width: 18px;
  }

  .pick input {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .table th label {
    color: var(--text-primary);
    cursor: pointer;
  }

  .tag {
    margin-left: 5px;
    padding: 0 4px;
    font-family: var(--font-editor);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--warning);
    border: 1px solid var(--warning);
  }

  .what {
    display: block;
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .count,
  .size {
    width: 76px;
    font-family: var(--font-editor);
    font-size: 10.5px;
    color: var(--text-secondary);
    text-align: right;
    white-space: nowrap;
  }

  .count {
    color: var(--text-muted);
  }

  .usage {
    font-family: var(--font-editor);
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .dialog-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .dialog-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .dialog-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .dialog-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #111;
  }

  .dialog-btn.primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  @media (max-width: 480px) {
    .help {
      padding-left: 8px;
    }
  }
</style>
