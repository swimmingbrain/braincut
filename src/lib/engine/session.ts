import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { getBlobForMedia } from '$lib/media/sources';
import { createClipFromMedia, createSequence } from '$lib/project/defaults';
import { activeSequence, mediaById } from '$lib/project/store';
import type { Id, MediaItem, Sequence } from '$lib/project/types';
import { loopPlayback, playhead, playing, previewQuality, renderStatus, showSafeMargins, sourceMedia } from '$lib/stores/app';
import { preferences } from '$lib/stores/preferences';
import { AudioEngine } from './audio-engine';
import { Compositor } from './compositor';
import { MediaCache } from './media-cache';
import { setDecoderPreference } from './media-reader';
import { Player } from './player';

export type { Player } from './player';

// the program monitor and the source monitor each get one of these: a
// compositor with its canvas, an audio engine and the player driving both.
// the media cache is shared so a file open in both costs one decoder set
export interface Session {
  player: Player;
  compositor: Compositor;
  audio: AudioEngine;
  cache: MediaCache;
  canvas: HTMLCanvasElement;
  destroy(): void;
}

type Unsubscribe = () => void;

let cache: MediaCache | null = null;
let cacheSubs: Unsubscribe[] = [];
let programSession: Session | null = null;
let sourceSession: Session | null = null;

// looked up per clip per frame, so it stays a plain map kept by subscription
// instead of a derived store read
let mediaMap = new Map<Id, MediaItem>();

function getMedia(id: Id): MediaItem | undefined {
  return mediaMap.get(id);
}

// what makes a file read differently: the bytes behind it or the way it
// is meant to be shown. names and labels don't count
function sameSource(a: MediaItem, b: MediaItem): boolean {
  return (
    a.status === b.status &&
    a.fileSize === b.fileSize &&
    a.duration === b.duration &&
    a.width === b.width &&
    a.height === b.height &&
    a.rotation === b.rotation &&
    a.proxy?.key === b.proxy?.key &&
    a.converted?.key === b.converted?.key
  );
}

function forgetMedia(id: Id): void {
  cache?.release(id);
  programSession?.compositor.forget(id);
  sourceSession?.compositor.forget(id);
}

function sharedCache(): MediaCache {
  if (cache) return cache;
  const created = new MediaCache({
    getBlob: (media) => getBlobForMedia(media, { preferProxy: get(preferences).useProxies })
  });
  cache = created;

  let lastPrefs = get(preferences);
  setDecoderPreference(lastPrefs.hardwareAcceleration);
  cacheSubs = [
    preferences.subscribe((prefs) => {
      // open readers hold the old file or decoder, they are reopened on demand
      if (prefs.hardwareAcceleration !== lastPrefs.hardwareAcceleration) setDecoderPreference(prefs.hardwareAcceleration);
      if (prefs.hardwareAcceleration !== lastPrefs.hardwareAcceleration || prefs.useProxies !== lastPrefs.useProxies) {
        created.release();
        programSession?.player.invalidate();
        sourceSession?.player.invalidate();
      }
      lastPrefs = prefs;
    }),
    mediaById.subscribe((map) => {
      const previous = mediaMap;
      mediaMap = map;
      let changed = false;
      for (const [id, item] of map) {
        const old = previous.get(id);
        if (old && old !== item && !sameSource(old, item)) {
          forgetMedia(id);
          changed = true;
        }
      }
      for (const id of previous.keys()) {
        if (!map.has(id)) forgetMedia(id);
      }
      if (changed) {
        programSession?.player.invalidate();
        sourceSession?.player.invalidate();
      }
    })
  ];
  return created;
}

function requireBrowser(): void {
  if (!browser) throw new Error('monitor sessions only exist in the browser');
}

export function program(): Session {
  requireBrowser();
  if (programSession) return programSession;
  const shared = sharedCache();
  let current = get(activeSequence);
  const compositor = new Compositor({
    width: current?.width ?? 1920,
    height: current?.height ?? 1080,
    scale: get(previewQuality)
  });
  const audio = new AudioEngine();
  let isPlaying = false;
  let published = get(playhead);
  const player = new Player({
    compositor,
    audio,
    cache: shared,
    getSequence: () => current,
    getMedia,
    audioScrubbing: () => get(preferences).audioScrubbing,
    onTime: (t) => {
      published = t;
      playhead.set(t);
    },
    onPlaying: (p) => {
      isPlaying = p;
      playing.set(p);
      // other work owns the other states, only the idle/playing pair is ours
      renderStatus.update((s) => (p ? (s === 'idle' ? 'playing' : s) : s === 'playing' ? 'idle' : s));
    }
  });

  let sequenceId = current?.id ?? null;
  const subs: Unsubscribe[] = [
    // fires on every project change, structural sharing keeps it cheap
    activeSequence.subscribe((seq) => {
      current = seq;
      const id = seq?.id ?? null;
      if (id !== sequenceId) {
        sequenceId = id;
        player.pause();
        player.seek(Math.min(player.currentTime(), player.duration()));
      }
      player.invalidate();
    }),
    previewQuality.subscribe((q) => player.setQuality(q)),
    showSafeMargins.subscribe((show) => player.setSafeMargins(show)),
    loopPlayback.subscribe((on) => player.setLoop(on)),
    // the player writes the playhead, but a write from elsewhere still lands
    playhead.subscribe((t) => {
      if (!isPlaying && t !== published) player.seek(t);
    })
  ];

  const session: Session = {
    player,
    compositor,
    audio,
    cache: shared,
    canvas: compositor.canvas,
    destroy() {
      if (programSession !== session) return;
      programSession = null;
      for (const off of subs) off();
      player.destroy();
      audio.destroy();
      compositor.destroy();
    }
  };
  programSession = session;
  player.seek(published);
  return session;
}

// the source monitor plays a sequence of its own: the file, whole, on one
// video and one audio track at its native size and rate
function sourceSequence(media: MediaItem, fps: number, stillDuration: number): Sequence {
  const seq = createSequence({
    name: media.name,
    width: media.width > 0 ? media.width : 1280,
    height: media.height > 0 ? media.height : 720,
    fps,
    sampleRate: media.sampleRate > 0 ? media.sampleRate : 48000,
    videoTracks: 1,
    audioTracks: 1
  });
  const clips = createClipFromMedia(media, 0, { fps, stillDuration });
  if (clips.video) seq.tracks[0].clips.push(clips.video);
  if (clips.audio) seq.tracks[1].clips.push(clips.audio);
  return seq;
}

export function source(): Session {
  requireBrowser();
  if (sourceSession) return sourceSession;
  const shared = sharedCache();
  const compositor = new Compositor({ width: 1280, height: 720, scale: get(previewQuality) });
  const audio = new AudioEngine();
  let current: Sequence | null = null;
  const player = new Player({
    compositor,
    audio,
    cache: shared,
    getSequence: () => current,
    getMedia,
    audioScrubbing: () => get(preferences).audioScrubbing
  });

  // the base sequence is rebuilt only when the file or its rate changes,
  // in/out are laid over it so clip ids stay put and the caches stay warm
  let base: { media: MediaItem; fps: number; still: number; seq: Sequence } | null = null;
  let lastValue: object | null = null;
  let lastTime: number | null = null;
  const refresh = () => {
    const value = get(sourceMedia);
    const media = value ? mediaMap.get(value.mediaId) : undefined;
    if (!value || !media) {
      if (current !== null) {
        player.pause();
        current = null;
        player.invalidate();
      }
      base = null;
      lastValue = null;
      lastTime = null;
      return;
    }
    const fps = media.fps && media.fps > 0 ? media.fps : get(activeSequence)?.fps ?? 30;
    const still = get(preferences).stillImageDuration;
    const fresh = base !== null && base.media === media && base.fps === fps && base.still === still ? base : null;
    if (fresh && value === lastValue) return;
    const previousId = base?.media.id ?? null;
    const built = fresh ?? { media, fps, still, seq: sourceSequence(media, fps, still) };
    base = built;
    lastValue = value;
    current = { ...built.seq, inPoint: value.in, outPoint: value.out > value.in ? value.out : null };
    if (previousId !== media.id) player.pause();
    if (value.time !== lastTime) {
      lastTime = value.time;
      player.seek(value.time);
    }
    player.invalidate();
  };

  const subs: Unsubscribe[] = [
    sourceMedia.subscribe(refresh),
    mediaById.subscribe(refresh),
    preferences.subscribe(refresh),
    activeSequence.subscribe(refresh),
    previewQuality.subscribe((q) => player.setQuality(q)),
    loopPlayback.subscribe((on) => player.setLoop(on))
  ];

  const session: Session = {
    player,
    compositor,
    audio,
    cache: shared,
    canvas: compositor.canvas,
    destroy() {
      if (sourceSession !== session) return;
      sourceSession = null;
      for (const off of subs) off();
      player.destroy();
      audio.destroy();
      compositor.destroy();
    }
  };
  sourceSession = session;
  return session;
}

export function destroySessions(): void {
  programSession?.destroy();
  sourceSession?.destroy();
  for (const off of cacheSubs) off();
  cacheSubs = [];
  cache?.dispose();
  cache = null;
  mediaMap = new Map();
}

if (import.meta.hot) {
  import.meta.hot.dispose(destroySessions);
}
