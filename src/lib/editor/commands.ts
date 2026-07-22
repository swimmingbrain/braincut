import { clearSelection, redo, undo } from '$lib/project/store';
import { program } from '$lib/engine/session';
import { pickFiles, pickFolder } from '$lib/media/import';
import { timelineActions } from './timeline-interactions';
import { insertSource, overwriteSource } from './source-actions';
import { closeCurrentProject, newProject, openProjectFile, saveProject, saveProjectAs } from './project-actions';
import { exportCurrentFrame } from './export-actions';
import {
  addGeneratedClip,
  clearInOut,
  goToIn,
  goToOut,
  markIn,
  markOut,
  openSpeedDialog,
  rippleTrimToPlayhead,
  setPreviewQuality,
  setToFrameSize,
  toggleFollowPlayhead,
  toggleLoop,
  toggleMuteSelection,
  toggleSnapping
} from './edit-actions';
import { tools } from './tools';
import { activeTool, dialog, selectedTransitionId, workspace, type Workspace } from '$lib/stores/app';

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  action: () => void;
}

const workspaces: { id: Workspace; label: string }[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'color', label: 'Color' },
  { id: 'effects', label: 'Effects' },
  { id: 'audio', label: 'Audio' }
];

function zoomEvent(name: 'zoom-in' | 'zoom-out' | 'zoom-fit'): void {
  window.dispatchEvent(new CustomEvent(`braincut:${name}`));
}

// everything the palette lists. the shortcut strings are for people, the
// keys themselves are bound in shortcuts.ts
export function buildCommands(): Command[] {
  const c = (id: string, label: string, category: string, action: () => unknown, shortcut?: string): Command => ({
    id,
    label,
    category,
    shortcut,
    action: () => void action()
  });

  const commands: Command[] = [
    // project
    c('new-project', 'New project', 'Project', newProject),
    c('open-project', 'Open project file', 'Project', openProjectFile, 'Ctrl+O'),
    c('save', 'Save project', 'Project', saveProject, 'Ctrl+S'),
    c('save-as', 'Save project as', 'Project', saveProjectAs, 'Ctrl+Shift+S'),
    c('close-project', 'Close project', 'Project', closeCurrentProject),
    c('import', 'Import media', 'Project', () => pickFiles(), 'Ctrl+I'),
    c('import-folder', 'Import folder', 'Project', () => pickFolder()),
    c('new-sequence', 'New sequence', 'Project', () => dialog.set({ kind: 'new-sequence' }), 'Ctrl+N'),
    c('sequence-settings', 'Sequence settings', 'Project', () => dialog.set({ kind: 'sequence-settings' })),
    c('export', 'Export', 'Project', () => dialog.set({ kind: 'export' }), 'Ctrl+M'),
    c('export-frame', 'Export current frame', 'Project', exportCurrentFrame, 'Ctrl+Shift+E'),

    // playback
    c('play', 'Play / pause', 'Playback', () => program().player.toggle(), 'Space'),
    c('go-start', 'Go to start', 'Playback', () => program().player.seek(0), 'Home'),
    c('go-end', 'Go to end', 'Playback', () => program().player.seek(program().player.duration()), 'End'),
    c('prev-edit', 'Go to previous edit', 'Playback', () => timelineActions.goToPrevEdit(), '↑'),
    c('next-edit', 'Go to next edit', 'Playback', () => timelineActions.goToNextEdit(), '↓'),
    c('go-in', 'Go to in point', 'Playback', goToIn, 'Shift+I'),
    c('go-out', 'Go to out point', 'Playback', goToOut, 'Shift+O'),
    c('loop', 'Toggle loop playback', 'Playback', toggleLoop),
    c('follow', 'Toggle follow playhead', 'Playback', toggleFollowPlayhead),
    c('quality-full', 'Preview quality: full', 'Playback', () => setPreviewQuality(1)),
    c('quality-half', 'Preview quality: half', 'Playback', () => setPreviewQuality(0.5)),
    c('quality-quarter', 'Preview quality: quarter', 'Playback', () => setPreviewQuality(0.25)),

    // marking
    c('mark-in', 'Mark in', 'Marking', markIn, 'I'),
    c('mark-out', 'Mark out', 'Marking', markOut, 'O'),
    c('clear-in-out', 'Clear in and out', 'Marking', clearInOut, 'Ctrl+Shift+X'),
    c('add-marker', 'Add marker', 'Marking', () => timelineActions.addMarkerAtPlayhead(), 'M'),
    c('lift', 'Lift', 'Marking', () => timelineActions.liftInOut(), ';'),
    c('extract', 'Extract', 'Marking', () => timelineActions.extractInOut(), "'"),
    c('insert', 'Insert from source', 'Marking', insertSource, ','),
    c('overwrite', 'Overwrite from source', 'Marking', overwriteSource, '.'),

    // editing
    c('split', 'Split at playhead', 'Edit', () => timelineActions.splitAtPlayhead(false), 'Ctrl+K'),
    c('split-all', 'Split all tracks at playhead', 'Edit', () => timelineActions.splitAtPlayhead(true), 'Ctrl+Shift+K'),
    c('delete', 'Delete selection', 'Edit', () => timelineActions.deleteSelection(), 'Delete'),
    c('ripple-delete', 'Ripple delete', 'Edit', () => timelineActions.rippleDeleteSelection(), 'Shift+Delete'),
    c('ripple-trim-prev', 'Ripple trim previous edit to playhead', 'Edit', () => rippleTrimToPlayhead('previous'), 'Q'),
    c('ripple-trim-next', 'Ripple trim next edit to playhead', 'Edit', () => rippleTrimToPlayhead('next'), 'W'),
    c('close-gap', 'Close gap at playhead', 'Edit', () => timelineActions.closeGapAtPlayhead()),
    c('video-transition', 'Add default video transition', 'Edit', () => timelineActions.addDefaultTransition('video'), 'Ctrl+D'),
    c('audio-transition', 'Add default audio transition', 'Edit', () => timelineActions.addDefaultTransition('audio'), 'Ctrl+Shift+D'),
    c('link', 'Link / unlink', 'Edit', () => timelineActions.linkSelection(), 'Ctrl+L'),
    c('enable', 'Enable / disable clip', 'Edit', () => timelineActions.toggleEnabled(), 'Shift+E'),
    c('speed', 'Speed / duration', 'Edit', openSpeedDialog, 'Ctrl+R'),
    c('mute', 'Mute / unmute selected audio', 'Edit', toggleMuteSelection, 'Ctrl+Alt+M'),
    c('frame-size', 'Set to frame size', 'Edit', setToFrameSize),
    c('add-title', 'Add title at playhead', 'Edit', () => addGeneratedClip('title')),
    c('add-color', 'Add color matte at playhead', 'Edit', () => addGeneratedClip('color')),
    c('add-adjustment', 'Add adjustment layer at playhead', 'Edit', () => addGeneratedClip('adjustment')),
    c('undo', 'Undo', 'Edit', undo, 'Ctrl+Z'),
    c('redo', 'Redo', 'Edit', redo, 'Ctrl+Shift+Z'),
    c('copy', 'Copy', 'Edit', () => timelineActions.copySelection(), 'Ctrl+C'),
    c('cut', 'Cut', 'Edit', () => timelineActions.cutSelection(), 'Ctrl+X'),
    c('paste', 'Paste at playhead', 'Edit', () => timelineActions.pasteAtPlayhead(), 'Ctrl+V'),
    c('select-all', 'Select all', 'Edit', () => timelineActions.selectAll(), 'Ctrl+A'),
    c(
      'deselect',
      'Deselect all',
      'Edit',
      () => {
        clearSelection();
        selectedTransitionId.set(null);
      },
      'Ctrl+Shift+A'
    ),

    // view
    c('snap', 'Toggle snapping', 'View', toggleSnapping, 'S'),
    c('zoom-in', 'Zoom in', 'View', () => zoomEvent('zoom-in'), '='),
    c('zoom-out', 'Zoom out', 'View', () => zoomEvent('zoom-out'), '-'),
    c('zoom-fit', 'Zoom to fit', 'View', () => zoomEvent('zoom-fit'), '\\'),
    c('shortcuts', 'Keyboard shortcuts', 'View', () => dialog.set({ kind: 'shortcuts' }), '?'),
    c('preferences', 'Preferences', 'View', () => dialog.set({ kind: 'preferences' }), 'Ctrl+,'),
    c('about', 'About brainCUT', 'View', () => dialog.set({ kind: 'about' }))
  ];

  for (const ws of workspaces) {
    commands.push(c(`workspace-${ws.id}`, `Workspace: ${ws.label}`, 'View', () => workspace.set(ws.id)));
  }
  for (const tool of tools) {
    commands.push(c(`tool-${tool.id}`, `Tool: ${tool.label}`, 'Tools', () => activeTool.set(tool.id), tool.shortcut));
  }

  // the palette closes before it runs an action, so a command that opens a
  // dialog never fights it for the keyboard
  return commands.map((cmd) => ({ ...cmd, action: () => queueMicrotask(cmd.action) }));
}
