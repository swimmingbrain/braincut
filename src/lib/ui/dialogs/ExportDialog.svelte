<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Dialog from '../Dialog.svelte';
  import Field from '../Field.svelte';
  import NumberField from '../NumberField.svelte';
  import SelectField from '../SelectField.svelte';
  import ToggleField from '../ToggleField.svelte';
  import Icon from '../Icon.svelte';
  import { activeSequence, mediaById } from '$lib/project/store';
  import { addToast, exportJob, renderStatus } from '$lib/stores/app';
  import { formatDuration } from '$lib/project/time';
  import {
    availablePresets,
    estimateSize,
    fileNameFor,
    mimeTypeFor,
    resolveCodecs,
    roundEven,
    settingsFromPreset,
    type Container,
    type ExportAudioCodec,
    type ExportPreset,
    type ExportSettings,
    type ExportVideoCodec,
    type QualityLevel
  } from '$lib/export/presets';
  import { exportSequence, type ExportTarget } from '$lib/export/render';
  import { exportRange } from '$lib/export/scene';

  let { onclose }: { onclose: () => void } = $props();

  const STORAGE_KEY = 'braincut-export';

  let presets = $state<ExportPreset[]>([]);
  let presetId = $state('match');
  let settings = $state<ExportSettings | null>(null);
  let lockAspect = $state(true);
  let notes = $state<string[]>([]);
  let fileName = $state('');
  let nameTouched = $state(false);
  let job = $state<{ progress: number; stage: string; eta: number | null } | null>(null);
  let error = $state<string | null>(null);
  let controller: AbortController | null = null;

  const seq = $derived($activeSequence);
  const preset = $derived(presets.find((p) => p.id === presetId) ?? null);
  const hasInOut = $derived(!!seq && seq.inPoint !== null && seq.outPoint !== null && seq.outPoint > seq.inPoint);
  const range = $derived(seq && settings ? exportRange(seq, settings.range) : null);
  const duration = $derived(range ? range.end - range.start : 0);
  const estimated = $derived(settings && seq ? estimateSize(settings, duration, seq.sampleRate) : 0);
  const isGif = $derived(settings?.container === 'gif');
  const isWav = $derived(settings?.container === 'wav');

  const containerOptions: { value: Container; label: string }[] = [
    { value: 'mp4', label: 'MP4' },
    { value: 'webm', label: 'WebM' },
    { value: 'mov', label: 'MOV' },
    { value: 'mkv', label: 'MKV' },
    { value: 'gif', label: 'GIF' },
    { value: 'wav', label: 'WAV (audio only)' }
  ];
  const videoCodecOptions: { value: ExportVideoCodec; label: string }[] = [
    { value: 'avc', label: 'H.264' },
    { value: 'hevc', label: 'H.265' },
    { value: 'vp9', label: 'VP9' },
    { value: 'av1', label: 'AV1' },
    { value: 'vp8', label: 'VP8' }
  ];
  const audioCodecOptions: { value: ExportAudioCodec; label: string }[] = [
    { value: 'aac', label: 'AAC' },
    { value: 'opus', label: 'Opus' },
    { value: 'pcm-s16', label: 'PCM 16-bit' },
    { value: 'flac', label: 'FLAC' }
  ];
  const qualityOptions: { value: QualityLevel; label: string }[] = [
    { value: 'very-low', label: 'Very low' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
    { value: 'very-high', label: 'Very high' },
    { value: 'custom', label: 'Custom bitrate' }
  ];
  const accelOptions = [
    { value: 'no-preference', label: 'Automatic' },
    { value: 'prefer-hardware', label: 'Prefer hardware' },
    { value: 'prefer-software', label: 'Prefer software' }
  ];
  const fpsOptions = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map((f) => ({ value: String(f), label: String(f) }));
  // an unusual sequence rate still has to be selectable, so it is listed first
  const fpsChoices = $derived.by(() => {
    const current = settings ? String(settings.fps) : null;
    if (!current || fpsOptions.some((o) => o.value === current)) return fpsOptions;
    return [{ value: current, label: current }, ...fpsOptions];
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
    return `${(bytes / 1e9).toFixed(2)} GB`;
  }

  function formatEta(seconds: number | null): string {
    if (seconds === null || !Number.isFinite(seconds)) return 'estimating';
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')} left`;
  }

  function applyPreset(p: ExportPreset) {
    if (!seq) return;
    presetId = p.id;
    settings = settingsFromPreset(p, seq);
    if (!nameTouched) fileName = fileNameFor(seq.name, settings.container);
  }

  function patch(fn: (s: ExportSettings) => void) {
    if (!settings) return;
    fn(settings);
    if (!nameTouched && seq) fileName = fileNameFor(seq.name, settings.container);
  }

  function setWidth(w: number) {
    patch((s) => {
      const ratio = s.height / s.width;
      s.width = roundEven(w);
      if (lockAspect) s.height = roundEven(w * ratio);
    });
  }

  function setHeight(h: number) {
    patch((s) => {
      const ratio = s.width / s.height;
      s.height = roundEven(h);
      if (lockAspect) s.width = roundEven(h * ratio);
    });
  }

  function remember() {
    if (!settings) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId, settings: $state.snapshot(settings) }));
    } catch {}
  }

  onMount(() => {
    void (async () => {
      const list = await availablePresets();
      presets = list;
      if (!seq) return;
      let restored: { presetId?: string; settings?: ExportSettings } | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) restored = JSON.parse(raw);
      } catch {}
      const first = list.find((p) => p.id === restored?.presetId) ?? list[0];
      if (first) applyPreset(first);
      // the last run's settings win over the preset, but the size follows the
      // sequence unless the preset pinned it
      if (restored?.settings && settings) {
        const keepSize = first?.settings.width === 'match';
        settings = {
          ...settings,
          ...restored.settings,
          ...(keepSize ? { width: settings.width, height: settings.height, fps: settings.fps } : {}),
          gif: { ...settings.gif, ...restored.settings.gif }
        };
        fileName = fileNameFor(seq.name, settings.container);
      }
    })();
    return () => controller?.abort();
  });

  // the codec check is async and cheap, so it runs whenever the choice
  // changes and only the notes come back, the settings themselves stay put
  $effect(() => {
    const current = settings ? $state.snapshot(settings) : null;
    if (!current) return;
    let alive = true;
    void resolveCodecs(current, undefined, seq?.sampleRate)
      .then((r) => {
        if (alive) notes = r.notes;
      })
      .catch((e: unknown) => {
        if (alive) notes = [e instanceof Error ? e.message : String(e)];
      });
    return () => {
      alive = false;
    };
  });

  async function pickTarget(container: Container, name: string): Promise<ExportTarget | null> {
    const picker = (window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName: string;
        types: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<FileSystemFileHandle>;
    }).showSaveFilePicker;
    if (!picker) return { kind: 'download', fileName: name };
    try {
      const handle = await picker({
        suggestedName: name,
        types: [{ description: `${container.toUpperCase()} file`, accept: { [mimeTypeFor(container)]: [`.${container}`] } }]
      });
      return { kind: 'handle', handle };
    } catch (e) {
      // the picker throws on cancel, that is not an error worth showing
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      return { kind: 'download', fileName: name };
    }
  }

  async function run() {
    if (!seq || !settings || job) return;
    error = null;
    const snapshot = $state.snapshot(settings);
    const resolved = await resolveCodecs(snapshot, undefined, seq.sampleRate).catch((e: unknown) => {
      error = e instanceof Error ? e.message : String(e);
      return null;
    });
    if (!resolved) return;
    const container = resolved.settings.container;
    const name = fileName.trim() ? fileNameFor(fileName.trim().replace(/\.[a-z0-9]+$/i, ''), container) : fileNameFor(seq.name, container);
    const target = await pickTarget(container, name);
    if (!target) return;
    remember();

    controller = new AbortController();
    const signal = controller.signal;
    const cancel = () => controller?.abort();
    job = { progress: 0, stage: 'Starting', eta: null };
    renderStatus.set('rendering');
    exportJob.set({ progress: 0, stage: 'Starting', eta: null, cancel });
    const media = get(mediaById);
    try {
      const { bytes } = await exportSequence(
        seq,
        resolved.settings,
        target,
        {
          signal,
          onProgress(progress, stage, eta) {
            job = { progress, stage, eta };
            exportJob.set({ progress, stage, eta, cancel });
          },
          onNote(note) {
            addToast(note, 'warning', 6000);
          }
        },
        (id) => media.get(id)
      );
      addToast(`Exported ${name} (${formatBytes(bytes)})`, 'success', 5000);
      onclose();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        addToast('Export cancelled', 'info');
      } else {
        error = e instanceof Error ? e.message : String(e);
      }
    } finally {
      job = null;
      controller = null;
      exportJob.set(null);
      renderStatus.set('idle');
    }
  }

  function close() {
    // escape and the backdrop must not throw away a running render
    if (job) return;
    onclose();
  }
</script>

<Dialog title="Export" description="Format, codec, quality and range." width={640} onclose={close}>
  {#if job}
    <div class="progress">
      <div class="progress-head">
        <span class="stage">{job.stage}</span>
        <span class="pct">{Math.round(job.progress * 100)}%</span>
      </div>
      <div class="bar"><div class="fill" style="transform: scaleX({Math.min(1, job.progress)})"></div></div>
      <div class="eta">{formatEta(job.eta)}</div>
    </div>
  {:else if settings && seq}
    <div class="layout">
      <div class="presets" role="listbox" aria-label="Presets">
        {#each presets as p (p.id)}
          <button
            class="preset"
            class:active={p.id === presetId}
            role="option"
            aria-selected={p.id === presetId}
            onclick={() => applyPreset(p)}>
            {p.name}
          </button>
        {/each}
        {#if preset}
          <p class="preset-desc">{preset.description}</p>
        {/if}
      </div>

      <div class="fields">
        <Field label="Format">
          <SelectField value={settings.container} options={containerOptions} onchange={(v) => patch((s) => (s.container = v as Container))} />
        </Field>

        {#if isGif}
          <Field label="Frame rate">
            <NumberField value={settings.gif.fps} min={1} max={50} precision={0} unit=" fps" onchange={(v) => patch((s) => (s.gif.fps = v))} />
          </Field>
          <Field label="Width">
            <NumberField value={settings.gif.width} min={16} max={seq.width} step={2} precision={0} unit="px" onchange={(v) => patch((s) => (s.gif.width = roundEven(v)))} />
          </Field>
          <Field label="Dither">
            <ToggleField value={settings.gif.dither} onchange={(v) => patch((s) => (s.gif.dither = v))} />
          </Field>
          <Field label="Loop">
            <ToggleField value={settings.gif.loop} onchange={(v) => patch((s) => (s.gif.loop = v))} />
          </Field>
        {:else}
          {#if !isWav}
            <Field label="Video">
              <ToggleField value={settings.includeVideo} onchange={(v) => patch((s) => (s.includeVideo = v))} />
            </Field>
            {#if settings.includeVideo}
              <Field label="Video codec">
                <SelectField
                  value={settings.videoCodec ?? 'avc'}
                  options={videoCodecOptions}
                  onchange={(v) => patch((s) => (s.videoCodec = v as ExportVideoCodec))} />
              </Field>
              <Field label="Size">
                <div class="size">
                  <NumberField value={settings.width} min={2} max={16384} step={2} precision={0} label="Width" onchange={setWidth} />
                  <button
                    class="lock"
                    class:on={lockAspect}
                    title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio free'}
                    aria-pressed={lockAspect}
                    onclick={() => (lockAspect = !lockAspect)}>
                    <Icon name={lockAspect ? 'lock' : 'unlock'} size={12} />
                  </button>
                  <NumberField value={settings.height} min={2} max={16384} step={2} precision={0} label="Height" onchange={setHeight} />
                </div>
              </Field>
              <Field label="Frame rate">
                <SelectField
                  value={String(settings.fps)}
                  options={fpsChoices}
                  onchange={(v) => patch((s) => (s.fps = Number(v)))} />
              </Field>
              <Field label="Quality">
                <SelectField value={settings.quality} options={qualityOptions} onchange={(v) => patch((s) => (s.quality = v as QualityLevel))} />
              </Field>
              {#if settings.quality === 'custom'}
                <Field label="Video bitrate">
                  <NumberField
                    value={settings.videoBitrate / 1e6}
                    min={0.1}
                    max={400}
                    step={0.5}
                    precision={1}
                    unit=" Mbps"
                    onchange={(v) => patch((s) => (s.videoBitrate = Math.round(v * 1e6)))} />
                </Field>
              {/if}
              <Field label="Key frame every">
                <NumberField value={settings.keyFrameInterval} min={0.1} max={30} step={0.5} precision={1} unit=" s" onchange={(v) => patch((s) => (s.keyFrameInterval = v))} />
              </Field>
              <Field label="Encoder">
                <SelectField
                  value={settings.hardwareAcceleration}
                  options={accelOptions}
                  onchange={(v) => patch((s) => (s.hardwareAcceleration = v as ExportSettings['hardwareAcceleration']))} />
              </Field>
            {/if}
          {/if}

          <Field label="Audio">
            <ToggleField value={settings.includeAudio} onchange={(v) => patch((s) => (s.includeAudio = v))} />
          </Field>
          {#if settings.includeAudio}
            <Field label="Audio codec">
              <SelectField
                value={settings.audioCodec ?? 'aac'}
                options={audioCodecOptions}
                onchange={(v) => patch((s) => (s.audioCodec = v as ExportAudioCodec))} />
            </Field>
            {#if settings.audioCodec === 'aac' || settings.audioCodec === 'opus'}
              <Field label="Audio bitrate">
                <NumberField
                  value={settings.audioBitrate / 1000}
                  min={32}
                  max={512}
                  step={16}
                  precision={0}
                  unit=" kbps"
                  onchange={(v) => patch((s) => (s.audioBitrate = Math.round(v) * 1000))} />
              </Field>
            {/if}
          {/if}
        {/if}

        <Field label="Range">
          <SelectField
            value={hasInOut ? settings.range : 'sequence'}
            options={[
              { value: 'sequence', label: 'Entire sequence' },
              { value: 'in-out', label: hasInOut ? 'In to out' : 'In to out (no in/out set)' }
            ]}
            disabled={!hasInOut}
            onchange={(v) => patch((s) => (s.range = v as ExportSettings['range']))} />
        </Field>

        <Field label="File name">
          <input
            class="name"
            value={fileName}
            spellcheck="false"
            aria-label="File name"
            oninput={(e) => {
              fileName = e.currentTarget.value;
              nameTouched = true;
            }}
            onkeydown={(e) => e.stopPropagation()} />
        </Field>

        <div class="summary">
          <span>{formatDuration(duration)}</span>
          <span class="dot">·</span>
          <span>about {formatBytes(estimated)}</span>
        </div>

        {#each notes as note (note)}
          <p class="note"><Icon name="info" size={12} />{note}</p>
        {/each}
        {#if error}
          <p class="error"><Icon name="warning" size={12} />{error}</p>
        {/if}
      </div>
    </div>
  {/if}

  {#snippet footer()}
    {#if job}
      <button class="dialog-btn" onclick={() => controller?.abort()}>Cancel</button>
    {:else}
      <button class="dialog-btn" onclick={close}>Close</button>
      <button class="dialog-btn accent" disabled={!settings || duration <= 0} onclick={run}>Export</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .layout {
    display: grid;
    grid-template-columns: 170px 1fr;
    gap: 12px;
    min-height: 0;
  }

  @media (max-width: 560px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  .presets {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    background: var(--bg-deep);
    align-self: start;
  }

  .preset {
    padding: 6px 10px;
    font-size: 12px;
    text-align: left;
    color: var(--text-secondary);
    border-left: 2px solid transparent;
  }

  .preset:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .preset.active {
    color: var(--text-primary);
    background: var(--bg-elevated);
    border-left-color: var(--accent);
  }

  .preset-desc {
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .size {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }

  .lock {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .lock:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .lock.on {
    color: var(--accent);
  }

  .name {
    width: 100%;
    padding: 3px 6px;
    font-family: var(--font-editor);
    font-size: 11.5px;
    line-height: 16px;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid transparent;
    border-bottom-color: var(--border);
    outline: none;
  }

  .name:focus {
    border-color: var(--accent);
  }

  .summary {
    display: flex;
    gap: 6px;
    padding: 8px 8px 0;
    font-family: var(--font-editor);
    font-size: 11px;
    color: var(--text-muted);
  }

  .dot {
    color: var(--border);
  }

  .note,
  .error {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px 0;
    font-size: 11.5px;
    line-height: 1.4;
    color: var(--warning);
  }

  .error {
    color: var(--error);
  }

  .progress {
    padding: 12px 0 4px;
  }

  .progress-head {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .pct {
    font-family: var(--font-editor);
    color: var(--text-primary);
  }

  .bar {
    height: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transform-origin: left;
    transition: transform 120ms linear;
  }

  .eta {
    margin-top: 8px;
    font-family: var(--font-editor);
    font-size: 11px;
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

  .dialog-btn.accent {
    background: var(--accent);
    border-color: var(--accent);
    color: #111;
  }

  .dialog-btn.accent:hover:not(:disabled) {
    background: var(--accent-hover);
    color: #111;
  }
</style>
