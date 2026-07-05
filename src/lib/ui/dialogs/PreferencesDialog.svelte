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
  import { list, remove, estimateQuota, formatBytes } from '$lib/media/opfs';
  import { forgetPeaks } from '$lib/media/waveform';

  let { onclose }: { onclose: () => void } = $props();

  const videoTransitions = transitionDefs.filter((d) => d.kind === 'video').map((d) => ({ value: d.id, label: d.name }));
  const audioTransitions = transitionDefs.filter((d) => d.kind === 'audio').map((d) => ({ value: d.id, label: d.name }));
  const qualityOptions = [
    { value: '1', label: 'Full' },
    { value: '0.5', label: 'Half' },
    { value: '0.25', label: 'Quarter' }
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

  let clearing = $state(false);
  let usage = $state<string | null>(null);

  estimateQuota().then((q) => {
    usage = q.usage > 0 ? formatBytes(q.usage) : null;
  });

  function set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    preferences.update((p) => ({ ...p, [key]: value }));
  }

  async function clearCache() {
    if (!confirm('Delete every proxy, converted file and cached waveform? Originals on disk are not touched. Proxies and conversions have to be made again.')) return;
    clearing = true;
    try {
      const keys = await list();
      await Promise.all(keys.map((k) => remove(k)));
      const p = get(project);
      if (p) await Promise.all(p.media.map((m) => forgetPeaks(m.id)));
      if (p) {
        // the project still points at the files that just went away
        edit('clear cached data', (draft) => {
          for (const m of draft.media) {
            m.proxy = null;
            m.converted = null;
          }
        });
      }
      usage = null;
      addToast(`Cleared ${keys.length} cached ${keys.length === 1 ? 'file' : 'files'}`, 'success');
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Could not clear the cache', 'error');
    } finally {
      clearing = false;
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
    <p class="help">The size the program monitor renders at. Half is plenty on most screens and keeps playback smooth. Exports are always full size.</p>
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
    <Field label="Cached data">
      <div class="row">
        <button class="dialog-btn" onclick={clearCache} disabled={clearing}>{clearing ? 'Clearing…' : 'Clear cached data'}</button>
        {#if usage}<span class="usage">{usage} in use</span>{/if}
      </div>
    </Field>
    <p class="help">Removes proxies, converted copies and waveform caches from the browser. Your original files are never touched.</p>
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
