import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

vi.mock('$lib/stores/app', () => ({ selection: writable<string[]>([]) }));

import { selection } from '$lib/stores/app';
import { activeSequence, cancelPreview, clearSelection, closeProject, commitPreview, dirty, edit, editSequence, findClip, history, loadProject, markSaved, mediaById, preview, project, redo, selectClips, selectedClips, setActiveSequence, undo } from './store';
import { createClipFromMedia, createProject, createSequence, createTitleClip } from './defaults';
import type { MediaItem, Project } from './types';

function media(): MediaItem {
  return {
    id: 'm1', name: 'clip.mp4', kind: 'video', binId: null, duration: 10, width: 1920, height: 1080, fps: 25,
    hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000, videoCodec: 'avc', audioCodec: 'aac',
    container: 'mp4', mimeType: 'video/mp4', fileSize: 1, rotation: 0, alpha: false, status: 'ready',
    proxy: null, converted: null, thumbnail: null, label: 'none', addedAt: 0
  };
}

function fresh(): Project {
  const p = createProject('Test');
  const seq = createSequence({ name: 'Main', width: 1920, height: 1080, fps: 25 });
  p.sequences.push(seq);
  p.activeSequenceId = seq.id;
  p.media.push(media());
  return p;
}

describe('project store', () => {
  beforeEach(() => {
    loadProject(fresh());
  });

  it('derives the active sequence and media map', () => {
    expect(get(activeSequence)?.name).toBe('Main');
    expect(get(mediaById).get('m1')?.name).toBe('clip.mp4');
    expect(get(dirty)).toBe(false);
  });

  it('records undo steps and tracks dirtiness', () => {
    editSequence('Add title', (seq) => {
      seq.tracks[0].clips.push(createTitleClip(0, 2, 'hello'));
    });
    expect(get(activeSequence)?.tracks[0].clips).toHaveLength(1);
    expect(get(dirty)).toBe(true);
    expect(get(history)).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'Add title', entries: ['Add title'], index: 1 });
    undo();
    expect(get(activeSequence)?.tracks[0].clips).toHaveLength(0);
    expect(get(history).redoLabel).toBe('Add title');
    redo();
    expect(get(activeSequence)?.tracks[0].clips).toHaveLength(1);
    markSaved();
    expect(get(dirty)).toBe(false);
    undo();
    expect(get(dirty)).toBe(true);
  });

  it('skips edits that change nothing', () => {
    edit('Nothing', () => {});
    expect(get(history).canUndo).toBe(false);
    expect(get(dirty)).toBe(false);
  });

  it('freezes the project so nothing mutates it outside an edit', () => {
    expect(Object.isFrozen(get(project))).toBe(true);
    edit('Rename', (d) => void (d.name = 'x'));
    expect(Object.isFrozen(get(project)?.sequences[0])).toBe(true);
  });

  it('turns a preview into one undo step', () => {
    editSequence('Add title', (seq) => void seq.tracks[0].clips.push(createTitleClip(0, 2, 'a')));
    const clipId = get(activeSequence)!.tracks[0].clips[0].id;
    for (const start of [1, 2, 3]) {
      preview((d) => void (findClip(d, clipId)!.clip.start = start));
    }
    expect(get(activeSequence)?.tracks[0].clips[0].start).toBe(3);
    expect(get(history).entries).toEqual(['Add title']);
    commitPreview('Move clip');
    expect(get(history).entries).toEqual(['Add title', 'Move clip']);
    undo();
    expect(get(activeSequence)?.tracks[0].clips[0].start).toBe(0);
    redo();
    expect(get(activeSequence)?.tracks[0].clips[0].start).toBe(3);
    expect(get(activeSequence)?.tracks[0].clips[0].id).toBe(clipId);
  });

  it('cancels a preview back to the base', () => {
    preview((d) => void (d.name = 'temp'));
    expect(get(project)?.name).toBe('temp');
    cancelPreview();
    expect(get(project)?.name).toBe('Test');
    expect(get(history).canUndo).toBe(false);
    commitPreview('nothing');
    expect(get(history).canUndo).toBe(false);
  });

  it('flushes an open preview before an edit', () => {
    preview((d) => void (d.name = 'dragged'));
    edit('Rename', (d) => void (d.name = 'renamed'));
    expect(get(history).entries).toEqual(['Rename', 'Rename']);
    undo();
    expect(get(project)?.name).toBe('dragged');
    undo();
    expect(get(project)?.name).toBe('Test');
  });

  it('selects linked clips together', () => {
    editSequence('Add media', (seq) => {
      const { video, audio } = createClipFromMedia(media(), 0, { fps: 25 });
      seq.tracks[0].clips.push(video!);
      seq.tracks[3].clips.push(audio!);
      seq.tracks[1].clips.push(createTitleClip(0, 1, 't'));
    });
    const seq = get(activeSequence)!;
    const videoId = seq.tracks[0].clips[0].id;
    const titleId = seq.tracks[1].clips[0].id;
    selectClips([videoId]);
    expect(get(selection).sort()).toEqual([videoId, seq.tracks[3].clips[0].id].sort());
    selectClips([titleId], 'add');
    expect(selectedClips()).toHaveLength(3);
    selectClips([videoId], 'toggle');
    expect(get(selection)).toEqual([titleId]);
    clearSelection();
    expect(selectedClips()).toEqual([]);
  });

  it('switches sequences without an undo step', () => {
    edit('Add sequence', (d) => void d.sequences.push(createSequence({ name: 'Second', width: 1, height: 1, fps: 25 })));
    const second = get(project)!.sequences[1].id;
    setActiveSequence(second);
    expect(get(activeSequence)?.name).toBe('Second');
    expect(get(history).entries).toEqual(['Add sequence']);
    closeProject();
    expect(get(project)).toBeNull();
    expect(get(activeSequence)).toBeNull();
  });
});
