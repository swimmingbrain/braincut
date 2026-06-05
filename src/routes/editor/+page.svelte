<script lang="ts">
  import TopBar from '$lib/ui/TopBar.svelte';
  import StatusBar from '$lib/ui/StatusBar.svelte';
  import PanelTabs from '$lib/ui/PanelTabs.svelte';
  import Resizer from '$lib/ui/Resizer.svelte';
  import ToolStrip from '$lib/ui/ToolStrip.svelte';
  import CommandPalette from '$lib/ui/CommandPalette.svelte';
  import ContextMenu from '$lib/ui/ContextMenu.svelte';
  import Dialogs from '$lib/ui/Dialogs.svelte';
  import Welcome from '$lib/ui/Welcome.svelte';

  import SourceMonitor from '$lib/ui/SourceMonitor.svelte';
  import EffectControls from '$lib/ui/EffectControls.svelte';
  import AudioMixer from '$lib/ui/AudioMixer.svelte';
  import ProgramMonitor from '$lib/ui/ProgramMonitor.svelte';
  import ProjectPanel from '$lib/ui/ProjectPanel.svelte';
  import EffectsPanel from '$lib/ui/EffectsPanel.svelte';
  import MarkersPanel from '$lib/ui/MarkersPanel.svelte';
  import HistoryPanel from '$lib/ui/HistoryPanel.svelte';
  import Timeline from '$lib/ui/timeline/Timeline.svelte';

  import { project } from '$lib/project/store';
  import {
    leftPanelTab,
    bottomPanelTab,
    panelSizes,
    dialog,
    type LeftPanelTab,
    type BottomPanelTab
  } from '$lib/stores/app';

  const MIN_LEFT = 280;
  const MIN_ROW = 180;

  let main = $state<HTMLElement | null>(null);

  const topTabs = [
    { id: 'source', label: 'Source' },
    { id: 'effect-controls', label: 'Effect Controls' },
    { id: 'audio-mixer', label: 'Audio Mixer' }
  ];

  const bottomTabs = [
    { id: 'project', label: 'Project' },
    { id: 'effects', label: 'Effects' },
    { id: 'markers', label: 'Markers' },
    { id: 'history', label: 'History' }
  ];

  function resizeLeft(delta: number) {
    const limit = (main?.clientWidth ?? 1200) - 320;
    panelSizes.update((sizes) => ({
      ...sizes,
      leftWidth: Math.max(MIN_LEFT, Math.min(sizes.leftWidth + delta, Math.max(MIN_LEFT, limit)))
    }));
  }

  function resizeTop(delta: number) {
    const height = main?.clientHeight ?? 800;
    if (height <= MIN_ROW * 2) return;
    const min = MIN_ROW / height;
    panelSizes.update((sizes) => ({
      ...sizes,
      topHeight: Math.max(min, Math.min(sizes.topHeight + delta / height, 1 - min))
    }));
  }

  // import, save and open reach into the media and persistence modules; the
  // shell only decides where their buttons live
  function noop() {}
</script>

<svelte:head>
  <title>brainCUT | Editor</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="editor-app">
  <TopBar onimport={noop} onsave={noop} onopen={noop} onexport={() => dialog.set({ kind: 'export' })} />

  {#if $project}
    <main
      class="main-area"
      bind:this={main}
      style="grid-template-columns: {$panelSizes.leftWidth}px 3px 1fr; grid-template-rows: {$panelSizes.topHeight}fr 3px {1 -
        $panelSizes.topHeight}fr">
      <section class="panel left-top">
        <PanelTabs
          tabs={topTabs}
          active={$leftPanelTab}
          onchange={(id) => leftPanelTab.set(id as LeftPanelTab)} />
        <div class="panel-body">
          {#if $leftPanelTab === 'source'}
            <SourceMonitor />
          {:else if $leftPanelTab === 'effect-controls'}
            <EffectControls />
          {:else}
            <AudioMixer />
          {/if}
        </div>
      </section>

      <div class="rz rz-v-top">
        <Resizer on:resize={(e) => resizeLeft(e.detail.delta)} />
      </div>

      <section class="panel program">
        <ProgramMonitor />
      </section>

      <div class="rz rz-h">
        <Resizer direction="horizontal" on:resize={(e) => resizeTop(e.detail.delta)} />
      </div>

      <section class="panel left-bottom">
        <PanelTabs
          tabs={bottomTabs}
          active={$bottomPanelTab}
          onchange={(id) => bottomPanelTab.set(id as BottomPanelTab)} />
        <div class="panel-body">
          {#if $bottomPanelTab === 'project'}
            <ProjectPanel />
          {:else if $bottomPanelTab === 'effects'}
            <EffectsPanel />
          {:else if $bottomPanelTab === 'markers'}
            <MarkersPanel />
          {:else}
            <HistoryPanel />
          {/if}
        </div>
      </section>

      <div class="rz rz-v-bottom">
        <Resizer on:resize={(e) => resizeLeft(e.detail.delta)} />
      </div>

      <section class="panel timeline-area">
        <ToolStrip />
        <div class="timeline-body">
          <Timeline />
        </div>
      </section>
    </main>
  {:else}
    <Welcome onopen={noop} onopenfile={noop} />
  {/if}

  <StatusBar />
</div>

<CommandPalette commands={[]} />
<ContextMenu />
<Dialogs />

<style>
  .editor-app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-deep);
    overflow: hidden;
  }

  .main-area {
    flex: 1;
    min-height: 0;
    display: grid;
    overflow: hidden;
  }

  .panel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-elevated);
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .rz {
    display: flex;
  }

  .left-top {
    grid-column: 1;
    grid-row: 1;
    border-right: 1px solid var(--border);
  }

  .rz-v-top {
    grid-column: 2;
    grid-row: 1;
  }

  .program {
    grid-column: 3;
    grid-row: 1;
    background: var(--bg-deep);
  }

  .rz-h {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .rz-h :global(.resizer) {
    flex: 1;
  }

  .left-bottom {
    grid-column: 1;
    grid-row: 3;
    border-right: 1px solid var(--border);
  }

  .rz-v-bottom {
    grid-column: 2;
    grid-row: 3;
  }

  .timeline-area {
    grid-column: 3;
    grid-row: 3;
    flex-direction: row;
    background: var(--bg-surface);
  }

  .timeline-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* one column on a narrow window: the picture first, then the timeline,
     then the panels. everything stays reachable, nothing is dropped */
  @media (max-width: 900px) {
    .main-area {
      grid-template-columns: 1fr !important;
      grid-template-rows: minmax(200px, 1.2fr) minmax(200px, 1fr) minmax(180px, 0.8fr) minmax(180px, 0.8fr) !important;
      overflow-y: auto;
    }

    .rz {
      display: none;
    }

    .program {
      grid-column: 1;
      grid-row: 1;
    }

    .timeline-area {
      grid-column: 1;
      grid-row: 2;
      border-top: 1px solid var(--border);
    }

    .left-top {
      grid-column: 1;
      grid-row: 3;
      border-right: none;
      border-top: 1px solid var(--border);
    }

    .left-bottom {
      grid-column: 1;
      grid-row: 4;
      border-right: none;
      border-top: 1px solid var(--border);
    }
  }
</style>
