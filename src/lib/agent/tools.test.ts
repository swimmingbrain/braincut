import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { runTool } from './tools';
import { createProject, createSequence } from '$lib/project/defaults';
import { activeSequence, history, loadProject } from '$lib/project/store';
import { selection } from '$lib/stores/app';
import type { MediaItem } from '$lib/project/types';

function media(): MediaItem {
  return {
    id: 'm1', name: 'clip.mp4', kind: 'video', binId: null, duration: 10, width: 1920, height: 1080, fps: 25,
    hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000, videoCodec: 'avc', audioCodec: 'aac',
    container: 'mp4', mimeType: 'video/mp4', fileSize: 1, rotation: 0, alpha: false, status: 'ready',
    proxy: null, converted: null, thumbnail: null, label: 'none', addedAt: 0
  };
}

function fresh(): void {
  const p = createProject('test');
  const s = createSequence({ name: 'Sequence 1', width: 1920, height: 1080, fps: 25 });
  p.sequences.push(s);
  p.activeSequenceId = s.id;
  p.media.push(media());
  loadProject(p);
}

const ctx = { emit() {} };
type Any = Record<string, any>;
const run = (tool: string, args: Record<string, unknown> = {}): Promise<Any> => runTool(tool, args, ctx) as Promise<Any>;

describe('agent tools', () => {
  beforeEach(fresh);

  it('reports what is open', async () => {
    const s = await run('status');
    expect(s.project.name).toBe('test');
    expect(s.sequences).toHaveLength(1);
    expect(s.sequences[0].active).toBe(true);
    expect(s.playhead).toBe(0);
  });

  it('lists media and the catalogs', async () => {
    const items = await run('list_media');
    expect(items[0]).toMatchObject({ id: 'm1', status: 'ready', duration: 10 });
    const effects = await run('catalog', { kind: 'effects' });
    expect(effects.some((e: Any) => e.id === 'gaussian-blur')).toBe(true);
    expect(effects.some((e: Any) => e.id === 'transform')).toBe(false);
    const transitions = await run('catalog', { kind: 'transitions' });
    expect(transitions.some((t: Any) => t.id === 'cross-dissolve')).toBe(true);
    expect((await run('catalog', { kind: 'blend_modes' }))).toContain('multiply');
    await expect(run('catalog', { kind: 'nope' })).rejects.toThrow(/catalog/);
  });

  it('adds a clip with its audio and appends the next one', async () => {
    const first = await run('add_clip', { mediaId: 'm1', sourceIn: 0, sourceOut: 4 });
    expect(first).toMatchObject({ start: 0, end: 4, track: 'V1' });
    expect(first.audioClipId).toBeTruthy();
    expect(get(selection)).toContain(first.clipId);
    const second = await run('add_clip', { mediaId: 'm1' });
    expect(second.start).toBe(4);
    expect(second.end).toBe(14);
    const timeline = await run('get_timeline');
    expect(timeline.tracks[0].clips).toHaveLength(2);
    expect(timeline.tracks[0].clips[1].mediaName).toBe('clip.mp4');
    const audio = timeline.tracks.find((t: Any) => t.kind === 'audio' && t.index === 0);
    expect(audio.clips).toHaveLength(2);
    expect(get(history).entries).toEqual(['add clip', 'add clip']);
  });

  it('refuses media it does not know or cannot use', async () => {
    await expect(run('add_clip', { mediaId: 'nope' })).rejects.toThrow(/list_media/);
    await expect(run('add_clip', { mediaId: 'm1', sourceIn: 3, sourceOut: 2 })).rejects.toThrow(/sourceOut/);
  });

  it('splits, trims, moves and deletes', async () => {
    const clip = await run('add_clip', { mediaId: 'm1' });
    const split = await run('split', { at: 4 });
    expect(split.left).toContain(clip.clipId);
    expect(split.right).toHaveLength(2);
    const trimmed = await run('trim', { clipId: clip.clipId, end: 3 });
    expect(trimmed).toMatchObject({ start: 0, end: 3 });
    const moved = await run('move_clip', { clipId: split.right[0], to: 5 });
    expect(moved.start).toBe(5);
    expect(moved.end).toBe(11);
    const gone = await run('delete_clips', { clipIds: [clip.clipId] });
    expect(gone.deleted).toHaveLength(2);
    const timeline = await run('get_timeline');
    expect(timeline.tracks[0].clips).toHaveLength(1);
    expect(timeline.tracks[0].clips[0].start).toBe(5);
    await expect(run('split', { at: 2 })).rejects.toThrow(/Nothing to split/);
  });

  it('ripple deletes and closes the gap', async () => {
    await run('add_clip', { mediaId: 'm1', sourceIn: 0, sourceOut: 2 });
    const second = await run('add_clip', { mediaId: 'm1', sourceIn: 0, sourceOut: 2 });
    await run('add_clip', { mediaId: 'm1', sourceIn: 0, sourceOut: 2 });
    await run('delete_clips', { clipIds: [second.clipId], ripple: true });
    const timeline = await run('get_timeline');
    expect(timeline.tracks[0].clips.map((c: Any) => c.start)).toEqual([0, 2]);
  });

  it('adds a styled title on the top video track', async () => {
    const title = await run('add_title', { text: 'Hello', at: 1, duration: 3, x: 0.5, y: 0.8, box: true, fontWeight: 650, color: '#ff0000' });
    expect(title).toMatchObject({ start: 1, end: 4 });
    const timeline = await run('get_timeline');
    const top = timeline.tracks.filter((t: Any) => t.kind === 'video').at(-1);
    expect(top.clips[0].title).toMatchObject({ text: 'Hello', color: '#ff0000', box: { x: 0.1, y: 0.8, width: 0.8 } });
    const seq = get(activeSequence)!;
    const clip = seq.tracks[2].clips[0];
    expect(clip.title?.fontWeight).toBe(700);
    expect(clip.title?.background?.color).toBe('#000000');
  });

  it('sets the basics of a clip', async () => {
    const clip = await run('add_clip', { mediaId: 'm1' });
    const result = await run('set_clip', { clipId: clip.clipId, opacity: 0.5, scale: 2, rotation: 15, position: { x: 10, y: -20 }, blendMode: 'screen', muted: true });
    expect(result.changed).toHaveLength(6);
    const seq = get(activeSequence)!;
    const video = seq.tracks[0].clips[0];
    const opacity = video.effects.find((e) => e.type === 'opacity')!;
    const transform = video.effects.find((e) => e.type === 'transform')!;
    expect(opacity.params.opacity).toBe(50);
    expect(opacity.params.blendMode).toBe('screen');
    expect(transform.params.scale).toBe(200);
    expect(transform.params.rotation).toBe(15);
    expect(transform.params.position).toEqual([10, -20]);
    const audio = seq.tracks[3].clips[0];
    expect(audio.effects.find((e) => e.type === 'volume')?.params.level).toBe(-60);
    await expect(run('set_clip', { clipId: clip.clipId, blendMode: 'nope' })).rejects.toThrow(/one of/);
    await expect(run('set_clip', { clipId: clip.clipId })).rejects.toThrow(/Nothing to change/);
  });

  it('puts a dissolve on the cut and a crossfade under it', async () => {
    await run('add_clip', { mediaId: 'm1', sourceIn: 0, sourceOut: 4 });
    const second = await run('add_clip', { mediaId: 'm1', sourceIn: 4, sourceOut: 8 });
    const made = await run('add_transition', { clipId: second.clipId, edge: 'in', duration: 1 });
    expect(made.transitionId).toBeTruthy();
    expect(made.audioTransitionId).toBeTruthy();
    const timeline = await run('get_timeline');
    expect(timeline.tracks[0].transitions[0]).toMatchObject({ type: 'cross-dissolve', duration: 1, rightClipId: second.clipId });
    expect(timeline.tracks[3].transitions[0].type).toBe('crossfade');
    const fade = await run('add_transition', { clipId: second.clipId, type: 'dip-to-black', edge: 'out' });
    expect(timeline.tracks[0].transitions).toHaveLength(1);
    expect(fade.transitionId).toBeTruthy();
    await expect(run('add_transition', { clipId: second.clipId, type: 'nope' })).rejects.toThrow(/transition/);
  });

  it('adds an effect, changes it, keyframes it and removes it', async () => {
    const clip = await run('add_clip', { mediaId: 'm1' });
    const blur = await run('add_effect', { clipId: clip.clipId, type: 'gaussian-blur', params: { strength: 500 } });
    const seq = () => get(activeSequence)!;
    let effect = seq().tracks[0].clips[0].effects.find((e) => e.id === blur.effectId)!;
    expect(effect.params.strength).toBe(200);
    await run('set_effect', { clipId: clip.clipId, effectId: blur.effectId, params: { quality: 'high' }, enabled: false });
    effect = seq().tracks[0].clips[0].effects.find((e) => e.id === blur.effectId)!;
    expect(effect.params.quality).toBe('high');
    expect(effect.enabled).toBe(false);
    await run('add_keyframe', { clipId: clip.clipId, param: `effect:${blur.effectId}:strength`, time: 0, value: 0 });
    await run('add_keyframe', { clipId: clip.clipId, param: `effect:${blur.effectId}:strength`, time: 2, value: 50, easing: 'ease-out' });
    effect = seq().tracks[0].clips[0].effects.find((e) => e.id === blur.effectId)!;
    expect(effect.keyframes.strength).toHaveLength(2);
    expect(effect.keyframes.strength[1]).toMatchObject({ time: 2, value: 50, easing: 'ease-out' });
    await expect(run('add_keyframe', { clipId: clip.clipId, param: 'nope', time: 0, value: 0 })).rejects.toThrow(/param must be/);
    await expect(run('add_keyframe', { clipId: clip.clipId, param: 'opacity', time: 20, value: 1 })).rejects.toThrow(/outside/);
    await run('add_keyframe', { clipId: clip.clipId, param: 'opacity', time: 1, value: 0.25 });
    const opacity = seq().tracks[0].clips[0].effects.find((e) => e.type === 'opacity')!;
    expect(opacity.keyframes.opacity[0]).toMatchObject({ time: 1, value: 25 });
    await run('add_keyframe', { clipId: clip.clipId, param: 'volume', time: 0, value: -12 });
    expect(seq().tracks[3].clips[0].effects.find((e) => e.type === 'volume')?.keyframes.level).toHaveLength(1);
    await run('remove_effect', { clipId: clip.clipId, effectId: blur.effectId });
    expect(seq().tracks[0].clips[0].effects.some((e) => e.id === blur.effectId)).toBe(false);
    await expect(run('remove_effect', { clipId: clip.clipId, effectId: opacity.id })).rejects.toThrow(/built into/);
    await expect(run('add_effect', { clipId: clip.clipId, type: 'nope' })).rejects.toThrow(/effect/);
  });

  it('adds an audio effect to the linked audio of a video clip', async () => {
    const clip = await run('add_clip', { mediaId: 'm1' });
    const made = await run('add_effect', { clipId: clip.clipId, type: 'compressor' });
    const audio = get(activeSequence)!.tracks[3].clips[0];
    expect(audio.effects.some((e) => e.id === made.effectId)).toBe(true);
  });

  it('adds markers and sequences', async () => {
    // 2.5 s is not on the 25 fps grid, 2.4 s is
    const marker = await run('add_marker', { time: 2.4, name: 'here', color: 'rose' });
    expect(marker.time).toBe(2.4);
    expect((await run('add_marker', { time: 2.5 })).time).toBe(2.52);
    await expect(run('add_marker', { time: 1, color: 'nope' })).rejects.toThrow(/color/);
    const seq = await run('new_sequence', { template: 'vertical1080', name: 'Shorts' });
    expect(seq).toMatchObject({ name: 'Shorts', width: 1080, height: 1920, fps: 30, active: true });
    expect((await run('status')).sequences).toHaveLength(2);
    await expect(run('new_sequence', { template: 'nope' })).rejects.toThrow(/template/);
  });

  it('undoes and redoes', async () => {
    await run('add_clip', { mediaId: 'm1' });
    const undone = await run('undo');
    expect(undone.undone).toBe('add clip');
    expect((await run('get_timeline')).tracks[0].clips).toHaveLength(0);
    await run('redo');
    expect((await run('get_timeline')).tracks[0].clips).toHaveLength(1);
    await run('undo');
    await expect(run('undo')).rejects.toThrow(/Nothing to undo/);
  });

  it('starts a fresh project only when asked to lose work', async () => {
    await run('add_clip', { mediaId: 'm1' });
    await expect(run('new_project', { name: 'next' })).rejects.toThrow(/unsaved/);
    const saved = await run('save_project');
    expect(saved.name).toBe('test.braincut');
    expect(JSON.parse(saved.json).name).toBe('test');
    const made = await run('new_project', { name: 'next' });
    expect(made.name).toBe('next');
    expect((await run('status')).project.name).toBe('next');
  });

  it('rejects tools it does not have', async () => {
    await expect(run('nope')).rejects.toThrow(/Unknown tool/);
  });
});
