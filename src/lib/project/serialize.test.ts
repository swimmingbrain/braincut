import { describe, expect, it } from 'vitest';
import { normalizeProject, parseProject, projectFileName, serializeProject } from './serialize';
import { createClipFromMedia, createProject, createSequence, createTitleClip } from './defaults';
import * as ops from './ops';
import type { MediaItem, Project } from './types';

function media(): MediaItem {
  return {
    id: 'm1', name: 'clip.mp4', kind: 'video', binId: null, duration: 10, width: 1920, height: 1080, fps: 25,
    hasVideo: true, hasAudio: true, channels: 2, sampleRate: 48000, videoCodec: 'avc', audioCodec: 'aac',
    container: 'mp4', mimeType: 'video/mp4', fileSize: 1, rotation: 90, alpha: false, status: 'ready',
    proxy: { key: 'p', width: 960, height: 540 }, converted: null, thumbnail: 'data:,', label: 'rose', addedAt: 1
  };
}

function sample(): Project {
  const p = createProject('My film');
  const seq = createSequence({ name: 'Main', width: 1920, height: 1080, fps: 25 });
  p.sequences.push(seq);
  p.activeSequenceId = seq.id;
  p.media.push(media());
  p.bins.push({ id: 'b1', name: 'Footage', parentId: null });
  const { video, audio } = createClipFromMedia(media(), 1, { fps: 25 });
  seq.tracks[0].clips.push(video!);
  seq.tracks[3].clips.push(audio!);
  const t = createTitleClip(11, 2, 'The end');
  t.effects[1].keyframes.opacity = [{ time: 0, value: 0, easing: 'ease-out' }, { time: 1, value: 100, easing: 'linear' }];
  seq.tracks[1].clips.push(t);
  ops.addTransition(seq, seq.tracks[0].id, { type: 'fade', leftClipId: null, rightClipId: video!.id, duration: 1 });
  seq.markers.push({ id: 'mk', time: 3, duration: 0, name: 'here', color: 'blue', note: '' });
  seq.inPoint = 1;
  seq.outPoint = 5;
  return p;
}

describe('serialize', () => {
  it('round trips a project', () => {
    const p = sample();
    const text = serializeProject(p);
    expect(text.startsWith('{\n  "id"')).toBe(true);
    const back = parseProject(text);
    expect(back).toEqual(p);
  });

  it('names the file after the project', () => {
    expect(projectFileName(createProject('My film: cut 2'))).toBe('My film- cut 2.braincut');
    expect(projectFileName(createProject('  '))).toBe('untitled.braincut');
  });

  it('fills defaults for missing optional fields', () => {
    const p = parseProject(JSON.stringify({
      name: 'old',
      sequences: [{
        name: 's', width: 1280, height: 720, fps: 30,
        tracks: [
          { kind: 'audio', clips: [] },
          { kind: 'video', clips: [{ kind: 'title', start: 0, duration: 2, title: { text: 'hi' } }] }
        ]
      }]
    }));
    expect(p.version).toBe(1);
    expect(p.id).toBeTruthy();
    expect(p.activeSequenceId).toBe(p.sequences[0].id);
    const seq = p.sequences[0];
    expect(seq.tracks.map((t) => t.kind)).toEqual(['video', 'audio']);
    expect(seq.sampleRate).toBe(48000);
    expect(seq.tracks[0].transitions).toEqual([]);
    expect(seq.tracks[0].height).toBe(56);
    const clip = seq.tracks[0].clips[0];
    expect(clip.effects.map((e) => e.type)).toEqual(['transform', 'opacity']);
    expect(clip.title?.text).toBe('hi');
    expect(clip.title?.fontFamily).toBe('Inter');
    expect(clip.speed).toBe(1);
    expect(clip.enabled).toBe(true);
  });

  it('drops keyframes and params it cannot read', () => {
    const p = parseProject(JSON.stringify({
      sequences: [{
        name: 's', width: 1, height: 1, fps: 25,
        tracks: [{ kind: 'video', clips: [{ kind: 'color', start: 0, duration: 1, color: '#ff0000', effects: [
          { type: 'blur', params: { amount: 5, bad: { x: 1 } }, keyframes: { amount: [{ time: 1, value: 3, easing: 'bogus' }, { time: 0, value: 'x' }, 'junk'] } }
        ] }] }]
      }]
    }));
    const effect = p.sequences[0].tracks[0].clips[0].effects.find((e) => e.type === 'blur')!;
    expect(effect.params).toEqual({ amount: 5 });
    expect(effect.keyframes.amount).toEqual([{ time: 0, value: 'x', easing: 'linear' }, { time: 1, value: 3, easing: 'linear' }]);
  });

  it('carries the identity of the file a media item came from', () => {
    const raw = {
      sequences: [{ name: 's', width: 1920, height: 1080, fps: 25, tracks: [] }],
      media: [
        { id: 'm1', name: 'Interview', kind: 'video', fileName: 'a001.mp4', fileSize: 1234, lastModified: 1700000000000, relativePath: 'day one/a001.mp4', status: 'ready' },
        { id: 'm2', name: 'old.mp4', kind: 'video', fileSize: 99, status: 'ready' }
      ]
    };
    const p = parseProject(JSON.stringify(raw));
    expect(p.media[0].fileName).toBe('a001.mp4');
    expect(p.media[0].lastModified).toBe(1700000000000);
    expect(p.media[0].relativePath).toBe('day one/a001.mp4');
    // a file written before these existed still loads, just without them
    expect(p.media[1].fileName).toBeUndefined();
    expect(p.media[1].lastModified).toBeUndefined();
    // and they survive a round trip through the file
    const again = parseProject(serializeProject(p));
    expect(again.media[0].fileName).toBe('a001.mp4');
    expect(again.media[0].lastModified).toBe(1700000000000);
    expect(again.media[0].relativePath).toBe('day one/a001.mp4');
  });

  it('throws readable errors on garbage', () => {
    expect(() => parseProject('not json')).toThrow(/valid JSON/);
    expect(() => parseProject('[]')).toThrow(/an object/);
    expect(() => parseProject('{"name":"x"}')).toThrow(/sequences/);
    expect(() => parseProject('{"sequences":[{"name":"s"}]}')).toThrow(/tracks/);
    expect(() => parseProject('{"sequences":[{"width":1,"height":1,"fps":25,"tracks":[{"kind":"video","clips":[{"kind":"potato","start":0,"duration":1}]}]}]}')).toThrow(/kind/);
    expect(() => parseProject('{"version":99,"sequences":[]}')).toThrow(/newer/);
    expect(() => normalizeProject(42)).toThrow();
  });
});
