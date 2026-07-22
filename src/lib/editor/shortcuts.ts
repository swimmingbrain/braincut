import { get } from 'svelte/store';
import { tinykeys, type KeybindingHandler, type KeybindingsMap } from 'tinykeys';
import { clearSelection, redo, undo } from '$lib/project/store';
import { program } from '$lib/engine/session';
import { pickFiles } from '$lib/media/import';
import { timelineActions } from './timeline-interactions';
import { insertSource, overwriteSource } from './source-actions';
import { openProjectFile, saveProject, saveProjectAs } from './project-actions';
import { exportCurrentFrame } from './export-actions';
import {
  clearInOut,
  focusPanel,
  goToIn,
  goToOut,
  markIn,
  markOut,
  openSpeedDialog,
  rippleTrimToPlayhead,
  toggleMuteSelection,
  toggleSnapping
} from './edit-actions';
import { tools } from './tools';
import {
  activeTool,
  commandPaletteOpen,
  contextMenu,
  dialog,
  playhead,
  selectedTransitionId,
  selection
} from '$lib/stores/app';
import { activeSequence } from '$lib/project/store';
import * as ops from '$lib/project/ops';

// the premiere-like map from the readme. every handler swallows the key so
// the page never scrolls or clicks a focused button behind it

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

// the timeline handles these itself while it has the focus
function insideTimeline(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.timeline') !== null;
}

function zoomEvent(name: 'zoom-in' | 'zoom-out' | 'zoom-fit'): void {
  window.dispatchEvent(new CustomEvent(`braincut:${name}`));
}

function escape(): void {
  if (get(contextMenu)) {
    contextMenu.set(null);
    return;
  }
  if (get(commandPaletteOpen)) {
    commandPaletteOpen.set(false);
    return;
  }
  if (get(dialog)) {
    dialog.set(null);
    return;
  }
  clearSelection();
  selectedTransitionId.set(null);
}

// ctrl+k splits, but with nothing to cut it opens the palette instead
function splitOrPalette(): void {
  const seq = get(activeSequence);
  const hasClip = seq ? get(selection).length > 0 || ops.clipsAt(seq, get(playhead)).length > 0 : false;
  if (hasClip) timelineActions.splitAtPlayhead(false);
  else commandPaletteOpen.set(true);
}

function player() {
  return program().player;
}

function bind(fn: () => unknown): KeybindingHandler {
  return (e) => {
    e.preventDefault();
    void fn();
  };
}

// delete and friends only when the timeline is not the one listening
function outsideTimeline(fn: () => unknown): KeybindingHandler {
  return (e) => {
    if (insideTimeline(e.target)) return;
    e.preventDefault();
    void fn();
  };
}

export function installShortcuts(target: Window | HTMLElement = window): () => void {
  const bindings: KeybindingsMap = {
    // playback
    Space: bind(() => player().toggle()),
    KeyJ: bind(() => player().shuttle(-1)),
    KeyK: bind(() => player().shuttle(0)),
    KeyL: bind(() => player().shuttle(1)),
    ArrowLeft: bind(() => player().step(-1)),
    ArrowRight: bind(() => player().step(1)),
    'Shift+ArrowLeft': bind(() => player().step(-5)),
    'Shift+ArrowRight': bind(() => player().step(5)),
    Home: bind(() => player().seek(0)),
    End: bind(() => player().seek(player().duration())),
    ArrowUp: bind(() => timelineActions.goToPrevEdit()),
    ArrowDown: bind(() => timelineActions.goToNextEdit()),

    // marking
    KeyI: bind(markIn),
    KeyO: bind(markOut),
    'Shift+KeyI': bind(goToIn),
    'Shift+KeyO': bind(goToOut),
    '$mod+Shift+KeyX': bind(clearInOut),
    KeyM: bind(() => timelineActions.addMarkerAtPlayhead()),
    Semicolon: bind(() => timelineActions.liftInOut()),
    Quote: bind(() => timelineActions.extractInOut()),
    Comma: bind(insertSource),
    Period: bind(overwriteSource),

    // editing
    '$mod+KeyK': bind(splitOrPalette),
    '$mod+Shift+KeyK': bind(() => timelineActions.splitAtPlayhead(true)),
    Delete: outsideTimeline(() => timelineActions.deleteSelection()),
    Backspace: outsideTimeline(() => timelineActions.deleteSelection()),
    'Shift+Delete': outsideTimeline(() => timelineActions.rippleDeleteSelection()),
    'Shift+Backspace': outsideTimeline(() => timelineActions.rippleDeleteSelection()),
    KeyQ: bind(() => rippleTrimToPlayhead('previous')),
    KeyW: bind(() => rippleTrimToPlayhead('next')),
    '$mod+KeyD': bind(() => timelineActions.addDefaultTransition('video')),
    '$mod+Shift+KeyD': bind(() => timelineActions.addDefaultTransition('audio')),
    '$mod+KeyL': bind(() => timelineActions.linkSelection()),
    'Shift+KeyE': bind(() => timelineActions.toggleEnabled()),
    '$mod+KeyR': bind(openSpeedDialog),
    '$mod+Alt+KeyM': bind(toggleMuteSelection),
    '$mod+KeyZ': bind(undo),
    '$mod+Shift+KeyZ': bind(redo),
    '$mod+KeyY': bind(redo),
    '$mod+KeyC': bind(() => timelineActions.copySelection()),
    '$mod+KeyX': bind(() => timelineActions.cutSelection()),
    '$mod+KeyV': bind(() => timelineActions.pasteAtPlayhead()),
    '$mod+KeyA': outsideTimeline(() => timelineActions.selectAll()),
    '$mod+Shift+KeyA': bind(() => {
      clearSelection();
      selectedTransitionId.set(null);
    }),

    // view
    KeyS: bind(toggleSnapping),
    Equal: bind(() => zoomEvent('zoom-in')),
    Minus: bind(() => zoomEvent('zoom-out')),
    NumpadAdd: bind(() => zoomEvent('zoom-in')),
    NumpadSubtract: bind(() => zoomEvent('zoom-out')),
    Backslash: bind(() => zoomEvent('zoom-fit')),
    'Shift+Digit1': bind(() => focusPanel('project')),
    'Shift+Digit2': bind(() => focusPanel('source')),
    'Shift+Digit3': bind(() => focusPanel('program')),
    'Shift+Digit4': bind(() => focusPanel('timeline')),
    'Shift+Digit5': bind(() => focusPanel('effects')),
    '$mod+Shift+KeyP': bind(() => commandPaletteOpen.set(true)),
    'Shift+Slash': bind(() => dialog.set({ kind: 'shortcuts' })),
    '$mod+Comma': bind(() => dialog.set({ kind: 'preferences' })),
    Escape: outsideTimeline(escape),

    // project
    '$mod+KeyS': bind(saveProject),
    '$mod+Shift+KeyS': bind(saveProjectAs),
    '$mod+KeyO': bind(openProjectFile),
    '$mod+KeyI': bind(() => pickFiles()),
    '$mod+KeyM': bind(() => dialog.set({ kind: 'export' })),
    '$mod+Shift+KeyE': bind(exportCurrentFrame),
    '$mod+KeyN': bind(() => dialog.set({ kind: 'new-sequence' }))
  };

  for (const tool of tools) {
    bindings[`Key${tool.shortcut}`] = bind(() => activeTool.set(tool.id));
  }

  return tinykeys(target, bindings, {
    ignore: (e) => {
      // fields handle their own keys, escape included
      if (editable(e.target)) return true;
      // elsewhere escape always gets through, it is how you leave things
      if (e.key === 'Escape') return false;
      // a dialog or the palette owns the keyboard while it is up
      return get(dialog) !== null || get(commandPaletteOpen);
    }
  });
}
