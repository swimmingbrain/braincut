<script lang="ts">
  import Dialog from '../Dialog.svelte';
  import Logo from '../Logo.svelte';
  import Icon from '../Icon.svelte';
  import { version } from '$lib/version';

  let { onclose }: { onclose: () => void } = $props();

  const libraries: { name: string; what: string; url: string }[] = [
    { name: 'SvelteKit', what: 'the app', url: 'https://svelte.dev' },
    { name: 'mediabunny', what: 'reading and writing media files', url: 'https://mediabunny.dev' },
    { name: 'PixiJS', what: 'compositing on the GPU', url: 'https://pixijs.com' },
    { name: 'pixi-filters', what: 'a good part of the video effects', url: 'https://github.com/pixijs/filters' },
    { name: 'gl-transitions', what: 'the video transitions', url: 'https://gl-transitions.com' },
    { name: 'ffmpeg.wasm', what: 'converting files the browser can\'t decode', url: 'https://ffmpegwasm.netlify.app' },
    { name: 'immer', what: 'undo and redo', url: 'https://immerjs.github.io/immer' },
    { name: 'idb-keyval', what: 'projects saved in the browser', url: 'https://github.com/jakearchibald/idb-keyval' },
    { name: 'gifenc', what: 'GIF export', url: 'https://github.com/mattdesl/gifenc' },
    { name: 'tinykeys', what: 'keyboard shortcuts', url: 'https://github.com/jamiebuilds/tinykeys' },
    { name: 'bezier-easing', what: 'keyframe curves', url: 'https://github.com/gre/bezier-easing' }
  ];
</script>

<Dialog title="About brainCUT" description="A video editor that runs entirely in your browser." {onclose}>
  <div class="about">
    <div class="brand">
      <span class="brand-logo"><Logo size={40} /></span>
      <div class="brand-text">
        <span class="brand-name">brainCUT</span>
        <span class="brand-version">version {version}</span>
      </div>
    </div>
    <p class="pitch">
      Cut video without the upload. Your footage is read straight from disk, decoded and rendered on this machine, and never sent anywhere.
    </p>
    <div class="links">
      <a href="https://cut.swimmingbrain.dev" target="_blank" rel="noopener">cut.swimmingbrain.dev</a>
      <a href="https://github.com/swimmingbrain/braincut" target="_blank" rel="noopener" class="with-icon"><Icon name="github" size={12} /> GitHub</a>
      <a href="https://github.com/swimmingbrain/braincut/blob/main/LICENSE" target="_blank" rel="noopener">MIT license</a>
    </div>
    <h3 class="section">Stands on</h3>
    <ul class="libs">
      {#each libraries as lib (lib.name)}
        <li>
          <a href={lib.url} target="_blank" rel="noopener">{lib.name}</a>
          <span class="what">{lib.what}</span>
        </li>
      {/each}
    </ul>
    <p class="made">made with &hearts; by <a href="https://swimmingbrain.dev" target="_blank" rel="noopener">Braian Plaku</a></p>
  </div>
  {#snippet footer()}
    <button class="dialog-btn" onclick={onclose}>Close</button>
  {/snippet}
</Dialog>

<style>
  .about {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .brand-logo {
    display: flex;
    color: var(--accent);
  }

  .brand-text {
    display: flex;
    flex-direction: column;
  }

  .brand-name {
    font-family: var(--font-brand);
    font-style: italic;
    font-size: 24px;
    line-height: 1.1;
    color: var(--text-primary);
  }

  .brand-version {
    font-family: var(--font-editor);
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .pitch {
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 11.5px;
  }

  .with-icon {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .section {
    margin-top: 4px;
    font-family: var(--font-editor);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    padding-bottom: 4px;
  }

  .libs {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 3px 12px;
    font-size: 11.5px;
  }

  .libs li {
    display: flex;
    gap: 6px;
    min-width: 0;
  }

  .what {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .made {
    margin-top: 6px;
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

  .dialog-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
