<script lang="ts">
  import Dialog from '../Dialog.svelte';
  import Field from '../Field.svelte';
  import NumberField from '../NumberField.svelte';
  import ColorField from '../ColorField.svelte';
  import SelectField from '../SelectField.svelte';
  import ToggleField from '../ToggleField.svelte';
  import { activeSequence, commitPreview, preview } from '$lib/project/store';
  import type { TitleData } from '$lib/project/types';
  import { ensureFontLoaded, fontFamilies } from '$lib/engine/text';

  // edits the title of one clip in place. every control writes straight into
  // the project, so the program monitor shows the text while it is typed;
  // a drag previews and commits once, a click commits right away
  let { clipId, onclose }: { clipId: string; onclose: () => void } = $props();

  const clip = $derived.by(() => {
    const seq = $activeSequence;
    if (!seq) return null;
    for (const track of seq.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) return found;
    }
    return null;
  });
  const title = $derived(clip?.title ?? null);

  const fontOptions = fontFamilies.map((f) => ({ value: f, label: f }));
  const weightOptions = [
    { value: '400', label: 'Regular' },
    { value: '500', label: 'Medium' },
    { value: '600', label: 'Semibold' },
    { value: '700', label: 'Bold' }
  ];
  const alignOptions = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' }
  ];

  function apply(patch: (t: TitleData) => void, live = false) {
    preview((draft) => {
      const seq = draft.sequences.find((s) => s.id === draft.activeSequenceId) ?? draft.sequences[0];
      if (!seq) return;
      for (const track of seq.tracks) {
        const c = track.clips.find((x) => x.id === clipId);
        if (c?.title) {
          patch(c.title);
          // the clip keeps the first line of its text as its name
          const firstLine = c.title.text.split('\n')[0].trim();
          c.name = firstLine || 'Title';
          return;
        }
      }
    });
    if (!live) commitPreview('edit title');
  }

  // a preview still open when the dialog goes (escape while typing) lands in history too
  function close() {
    commitPreview('edit title');
    onclose();
  }

  function loadFont(t: TitleData) {
    void ensureFontLoaded(t.fontFamily, t.fontWeight, t.italic);
  }
</script>

{#if title}
  <Dialog title="Title" description="Text, font, colour and placement." width={520} onclose={close}>
    <textarea
      class="text"
      rows="3"
      spellcheck="false"
      aria-label="Text"
      value={title.text}
      oninput={(e) => apply((t) => (t.text = e.currentTarget.value), true)}
      onchange={() => commitPreview('edit title')}
      onkeydown={(e) => e.stopPropagation()}></textarea>

    <div class="section">Font</div>
    <Field label="Family">
      <SelectField
        value={title.fontFamily}
        options={fontOptions}
        label="Family"
        onchange={(v) => {
          apply((t) => (t.fontFamily = v));
          if (title) loadFont({ ...title, fontFamily: v });
        }} />
    </Field>
    <Field label="Size">
      <NumberField
        value={title.fontSize}
        min={4}
        max={1000}
        unit="px"
        precision={0}
        label="Size"
        onchange={(v) => apply((t) => (t.fontSize = v))}
        oninput={(v) => apply((t) => (t.fontSize = v), true)} />
    </Field>
    <Field label="Weight">
      <SelectField
        value={String(title.fontWeight)}
        options={weightOptions}
        label="Weight"
        onchange={(v) => {
          const weight = Number(v) as TitleData['fontWeight'];
          apply((t) => (t.fontWeight = weight));
          if (title) loadFont({ ...title, fontWeight: weight });
        }} />
    </Field>
    <Field label="Italic">
      <ToggleField
        value={title.italic}
        label="Italic"
        onchange={(v) => {
          apply((t) => (t.italic = v));
          if (title) loadFont({ ...title, italic: v });
        }} />
    </Field>
    <Field label="Color">
      <ColorField
        value={title.color}
        label="Text"
        onchange={(v) => apply((t) => (t.color = v))}
        oninput={(v) => apply((t) => (t.color = v), true)} />
    </Field>
    <Field label="Align">
      <SelectField value={title.align} options={alignOptions} label="Align" onchange={(v) => apply((t) => (t.align = v as TitleData['align']))} />
    </Field>
    <Field label="Line height">
      <NumberField
        value={title.lineHeight}
        min={0.5}
        max={4}
        step={0.05}
        precision={2}
        label="Line height"
        onchange={(v) => apply((t) => (t.lineHeight = v))}
        oninput={(v) => apply((t) => (t.lineHeight = v), true)} />
    </Field>
    <Field label="Letter spacing">
      <NumberField
        value={title.letterSpacing}
        min={-50}
        max={200}
        step={0.5}
        unit="px"
        precision={1}
        label="Letter spacing"
        onchange={(v) => apply((t) => (t.letterSpacing = v))}
        oninput={(v) => apply((t) => (t.letterSpacing = v), true)} />
    </Field>

    <div class="section">
      Stroke
      <ToggleField
        value={title.stroke !== null}
        label="Stroke"
        onchange={(on) => apply((t) => (t.stroke = on ? { color: '#000000', width: 4 } : null))} />
    </div>
    {#if title.stroke}
      {@const stroke = title.stroke}
      <Field label="Color">
        <ColorField
          value={stroke.color}
          label="Stroke"
          onchange={(v) => apply((t) => t.stroke && (t.stroke.color = v))}
          oninput={(v) => apply((t) => t.stroke && (t.stroke.color = v), true)} />
      </Field>
      <Field label="Width">
        <NumberField
          value={stroke.width}
          min={0}
          max={100}
          step={0.5}
          unit="px"
          precision={1}
          label="Stroke width"
          onchange={(v) => apply((t) => t.stroke && (t.stroke.width = v))}
          oninput={(v) => apply((t) => t.stroke && (t.stroke.width = v), true)} />
      </Field>
    {/if}

    <div class="section">
      Shadow
      <ToggleField
        value={title.shadow !== null}
        label="Shadow"
        onchange={(on) => apply((t) => (t.shadow = on ? { color: '#000000', blur: 8, x: 4, y: 4 } : null))} />
    </div>
    {#if title.shadow}
      {@const shadow = title.shadow}
      <Field label="Color">
        <ColorField
          value={shadow.color}
          label="Shadow"
          onchange={(v) => apply((t) => t.shadow && (t.shadow.color = v))}
          oninput={(v) => apply((t) => t.shadow && (t.shadow.color = v), true)} />
      </Field>
      <Field label="Blur">
        <NumberField
          value={shadow.blur}
          min={0}
          max={200}
          unit="px"
          precision={0}
          label="Shadow blur"
          onchange={(v) => apply((t) => t.shadow && (t.shadow.blur = v))}
          oninput={(v) => apply((t) => t.shadow && (t.shadow.blur = v), true)} />
      </Field>
      <Field label="Offset">
        <div class="pair">
          <NumberField
            value={shadow.x}
            min={-500}
            max={500}
            unit="px"
            precision={0}
            label="Shadow x"
            onchange={(v) => apply((t) => t.shadow && (t.shadow.x = v))}
            oninput={(v) => apply((t) => t.shadow && (t.shadow.x = v), true)} />
          <NumberField
            value={shadow.y}
            min={-500}
            max={500}
            unit="px"
            precision={0}
            label="Shadow y"
            onchange={(v) => apply((t) => t.shadow && (t.shadow.y = v))}
            oninput={(v) => apply((t) => t.shadow && (t.shadow.y = v), true)} />
        </div>
      </Field>
    {/if}

    <div class="section">
      Background
      <ToggleField
        value={title.background !== null}
        label="Background"
        onchange={(on) => apply((t) => (t.background = on ? { color: '#000000', padding: 16 } : null))} />
    </div>
    {#if title.background}
      {@const background = title.background}
      <Field label="Color">
        <ColorField
          value={background.color}
          label="Background"
          onchange={(v) => apply((t) => t.background && (t.background.color = v))}
          oninput={(v) => apply((t) => t.background && (t.background.color = v), true)} />
      </Field>
      <Field label="Padding">
        <NumberField
          value={background.padding}
          min={0}
          max={500}
          unit="px"
          precision={0}
          label="Padding"
          onchange={(v) => apply((t) => t.background && (t.background.padding = v))}
          oninput={(v) => apply((t) => t.background && (t.background.padding = v), true)} />
      </Field>
    {/if}

    <div class="section">Box</div>
    <Field label="Position" hint="Left and top edge of the box, as a share of the frame">
      <div class="pair">
        <NumberField
          value={title.box.x * 100}
          min={-100}
          max={200}
          step={0.5}
          unit="%"
          precision={1}
          label="Box x"
          onchange={(v) => apply((t) => (t.box.x = v / 100))}
          oninput={(v) => apply((t) => (t.box.x = v / 100), true)} />
        <NumberField
          value={title.box.y * 100}
          min={-100}
          max={200}
          step={0.5}
          unit="%"
          precision={1}
          label="Box y"
          onchange={(v) => apply((t) => (t.box.y = v / 100))}
          oninput={(v) => apply((t) => (t.box.y = v / 100), true)} />
      </div>
    </Field>
    <Field label="Width">
      <NumberField
        value={title.box.width * 100}
        min={1}
        max={300}
        step={0.5}
        unit="%"
        precision={1}
        label="Box width"
        onchange={(v) => apply((t) => (t.box.width = v / 100))}
        oninput={(v) => apply((t) => (t.box.width = v / 100), true)} />
    </Field>

    {#snippet footer()}
      <button class="dialog-btn" onclick={close}>Done</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .text {
    display: block;
    width: 100%;
    padding: 6px 8px;
    margin-bottom: 8px;
    font-family: var(--font-ui);
    font-size: 12.5px;
    line-height: 1.4;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    outline: none;
    resize: vertical;
  }

  .text:focus {
    border-color: var(--accent);
  }

  .section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    margin-top: 6px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
  }

  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    width: 100%;
  }

  .dialog-btn {
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
  }

  .dialog-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
