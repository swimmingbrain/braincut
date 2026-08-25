import { writable, type Readable } from 'svelte/store';
import type { Id, MediaItem, Sequence } from '$lib/project/types';
import { sequenceDuration } from '$lib/project/defaults';
import { snapToFrame, timeToFrame } from '$lib/project/time';
import type { AudioEngine } from './audio-engine';
import { sourceTimeAt } from './clip-time';
import type { Compositor } from './compositor';
import type { FrameMode, MediaCache } from './media-cache';

export type PreviewScale = 1 | 0.5 | 0.25 | 0.125;

export interface PlayerStats {
  // frames drawn per second, 0 while paused
  fps: number;
  // frames the compositor was too slow for, counted since the player was made
  dropped: number;
}

export interface PlayerOptions {
  compositor: Compositor;
  audio: AudioEngine;
  cache: MediaCache;
  // the sequence can change identity any time, every frame asks again
  getSequence: () => Sequence | null;
  getMedia: (id: Id) => MediaItem | undefined;
  // whether a seek while paused also plays a slice of sound
  audioScrubbing?: () => boolean;
  onTime?: (t: number) => void;
  onPlaying?: (playing: boolean) => void;
}

// j and l double the speed each press up to this
export const MAX_SHUTTLE = 8;
const PREFETCH_AHEAD = 1.5;
const PREFETCH_EVERY = 500;
const STATS_EVERY = 500;
const EPS = 1e-6;

// the stretch playback covers: the in/out range when looping over one,
// else the whole sequence
export function playRange(seq: Sequence, loop: boolean): { start: number; end: number } {
  const duration = sequenceDuration(seq);
  if (loop && seq.inPoint !== null && seq.outPoint !== null && seq.outPoint > seq.inPoint) {
    return { start: seq.inPoint, end: Math.min(seq.outPoint, Math.max(duration, seq.inPoint)) };
  }
  return { start: 0, end: duration };
}

// j/k/l semantics: a press in the direction already playing doubles the
// speed, anything else plays at the rate asked for
export function nextShuttleRate(current: number, requested: number): number {
  if (requested === 0) return 0;
  if (current !== 0 && Math.abs(requested) === 1 && Math.sign(requested) === Math.sign(current)) {
    return Math.sign(requested) * Math.min(MAX_SHUTTLE, Math.abs(current) * 2);
  }
  return requested;
}

export class Player {
  readonly time: Readable<number>;
  readonly playing: Readable<boolean>;
  // signed playback rate, 0 while paused
  readonly rate: Readable<number>;
  readonly stats: Readable<PlayerStats>;
  // set while the picture cannot be drawn at all, so the monitor can offer
  // a way out instead of showing an unexplained black rectangle
  readonly problem: Readable<string | null>;

  private readonly compositor: Compositor;
  private readonly audio: AudioEngine;
  private readonly cache: MediaCache;
  private readonly getSequence: () => Sequence | null;
  private readonly getMedia: (id: Id) => MediaItem | undefined;
  private readonly audioScrubbing: () => boolean;
  private readonly onTime?: (t: number) => void;
  private readonly onPlaying?: (playing: boolean) => void;

  private readonly timeStore = writable(0);
  private readonly playingStore = writable(false);
  private readonly rateStore = writable(0);
  private readonly statsStore = writable<PlayerStats>({ fps: 0, dropped: 0 });
  private readonly problemStore = writable<string | null>(null);

  // the paused position, the audio clock owns the time while playing
  private position = 0;
  private isPlaying = false;
  private shuttleRate = 0;
  private loop = false;
  private quality: number;
  private safeMargins = false;
  private raf = 0;
  private rendering = false;
  // an edit or a setting changed, the picture on screen is stale
  private dirty = true;
  private pendingSeek: number | null = null;
  private lastFrame = -1;
  private lastSeq: Sequence | null = null;
  private playingSeq: Sequence | null = null;
  private seenFrame = -1;
  private rendered = 0;
  private dropped = 0;
  private statsAt = 0;
  private prefetchAt = 0;
  private warned = false;
  private failures = 0;
  private hasProblem = false;
  private destroyed = false;

  constructor(opts: PlayerOptions) {
    this.compositor = opts.compositor;
    this.audio = opts.audio;
    this.cache = opts.cache;
    this.getSequence = opts.getSequence;
    this.getMedia = opts.getMedia;
    this.audioScrubbing = opts.audioScrubbing ?? (() => false);
    this.onTime = opts.onTime;
    this.onPlaying = opts.onPlaying;
    this.quality = opts.compositor.scale;
    this.time = { subscribe: this.timeStore.subscribe };
    this.playing = { subscribe: this.playingStore.subscribe };
    this.rate = { subscribe: this.rateStore.subscribe };
    this.stats = { subscribe: this.statsStore.subscribe };
    this.problem = { subscribe: this.problemStore.subscribe };
  }

  currentTime(): number {
    return this.isPlaying ? this.audio.currentTime() : this.position;
  }

  duration(): number {
    const seq = this.getSequence();
    return seq ? sequenceDuration(seq) : 0;
  }

  play(): void {
    this.startPlaying(1);
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.audio.stop();
    const seq = this.getSequence();
    const t = this.audio.currentTime();
    this.position = seq ? this.clamp(snapToFrame(t, seq.fps), seq) : t;
    this.isPlaying = false;
    this.playingSeq = null;
    this.shuttleRate = 0;
    this.rateStore.set(0);
    this.playingStore.set(false);
    this.onPlaying?.(false);
    this.statsStore.update((s) => ({ fps: 0, dropped: s.dropped }));
    this.publish(this.position);
    // the frame on screen may be one the transport skipped, flush checks
    this.schedule();
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  seek(t: number): void {
    if (this.destroyed) return;
    const seq = this.getSequence();
    if (!seq) return;
    // the playhead may stand past the last clip, the way it does on a desktop
    // editor: that is where a paste or an insert lands after the end. there is
    // nothing to draw there, and playback still stops at the sequence end
    const target = Math.max(0, snapToFrame(Number.isFinite(t) ? t : 0, seq.fps));
    if (this.isPlaying) {
      this.audio.seek(target);
      // whatever frame is up, the one at the new time must be drawn
      this.lastFrame = -1;
      return;
    }
    this.position = target;
    this.pendingSeek = target;
    this.publish(target);
    this.schedule();
  }

  step(frames: number): void {
    const seq = this.getSequence();
    if (!seq) return;
    this.pause();
    this.seek((timeToFrame(this.position, seq.fps) + frames) / seq.fps);
  }

  shuttle(rate: number): void {
    const next = nextShuttleRate(this.isPlaying ? this.shuttleRate : 0, rate);
    if (next === 0) {
      this.pause();
      return;
    }
    this.startPlaying(next);
  }

  setLoop(enabled: boolean): void {
    this.loop = enabled;
  }

  // an edit changed the sequence, redraw the current frame. calls collapse
  // into one render per animation frame
  invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  setQuality(scale: PreviewScale): void {
    this.quality = scale;
    const seq = this.getSequence();
    if (seq) this.compositor.setSize(seq.width, seq.height, scale);
    this.invalidate();
  }

  setSafeMargins(show: boolean): void {
    if (this.safeMargins === show) return;
    this.safeMargins = show;
    this.invalidate();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.isPlaying) this.audio.stop();
    this.isPlaying = false;
  }

  private setProblem(message: string | null): void {
    const has = message !== null;
    if (has === this.hasProblem) return;
    this.hasProblem = has;
    this.problemStore.set(message);
  }

  private clamp(t: number, seq: Sequence): number {
    return Math.min(Math.max(0, t), sequenceDuration(seq));
  }

  private publish(t: number): void {
    this.timeStore.set(t);
    this.onTime?.(t);
  }

  private startPlaying(rate: number): void {
    if (this.destroyed) return;
    const seq = this.getSequence();
    if (!seq) return;
    const { start, end } = playRange(seq, this.loop);
    let from = this.isPlaying ? this.audio.currentTime() : this.position;
    // from the end, forward playback starts over; the same backwards. a
    // playhead parked past the end has nothing to play towards, so backwards
    // playback picks the last frame there is
    if (rate > 0 && from >= end - EPS) from = start;
    if (rate < 0 && (from <= start + EPS || from > end)) from = end;
    this.pendingSeek = null;
    this.audio.start(seq, this.getMedia, this.cache, from, rate);
    this.playingSeq = seq;
    this.shuttleRate = rate;
    this.rateStore.set(rate);
    this.lastFrame = -1;
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.statsAt = performance.now();
      this.rendered = 0;
      this.playingStore.set(true);
      this.onPlaying?.(true);
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.isPlaying) this.tick();
      else this.flush();
    });
  }

  // paused: redraw if the picture changed. a seek that lands while a
  // render is out stays pending, the render's end comes back here
  private flush(): void {
    const seq = this.getSequence();
    if (!seq) {
      this.pendingSeek = null;
      return;
    }
    if (this.rendering) return;
    const seeked = this.pendingSeek !== null;
    this.pendingSeek = null;
    const frame = timeToFrame(this.position, seq.fps);
    if (!this.dirty && frame === this.lastFrame && seq === this.lastSeq) return;
    this.render(seq, frame / seq.fps, 'scrub');
    if (seeked && this.audioScrubbing()) {
      void this.audio.scrubTo(seq, this.getMedia, this.cache, this.position);
    }
  }

  private tick(): void {
    if (!this.isPlaying || this.destroyed) return;
    const seq = this.getSequence();
    if (!seq) {
      this.pause();
      return;
    }
    if (seq !== this.playingSeq) {
      this.playingSeq = seq;
      this.audio.update(seq);
    }
    const now = performance.now();
    let t = this.audio.currentTime();
    const { start, end } = playRange(seq, this.loop);
    const forward = this.shuttleRate > 0;
    if (forward ? t >= end : t <= start) {
      if (this.loop && end > start) {
        t = forward ? start : end;
        this.audio.seek(t);
        this.lastFrame = -1;
      } else {
        this.stopAt(forward ? end : start);
        return;
      }
    }

    const frame = timeToFrame(t, seq.fps);
    if (frame !== this.lastFrame || this.dirty) {
      const frameTime = frame / seq.fps;
      this.publish(frameTime);
      if (this.rendering) {
        if (frame !== this.seenFrame) this.dropped++;
      } else {
        this.render(seq, frameTime, forward ? 'play' : 'scrub');
      }
      this.seenFrame = frame;
    }
    if (forward && now - this.prefetchAt > PREFETCH_EVERY) {
      this.prefetchAt = now;
      this.prefetch(seq, t);
    }
    if (now - this.statsAt > STATS_EVERY) {
      const fps = (this.rendered * 1000) / (now - this.statsAt);
      this.statsAt = now;
      this.rendered = 0;
      this.statsStore.set({ fps: Math.round(fps), dropped: this.dropped });
    }
    this.schedule();
  }

  private stopAt(t: number): void {
    this.pause();
    const seq = this.getSequence();
    this.position = seq ? this.clamp(snapToFrame(t, seq.fps), seq) : t;
    this.publish(this.position);
    this.schedule();
  }

  private render(seq: Sequence, t: number, mode: FrameMode): void {
    this.compositor.setSize(seq.width, seq.height, this.quality);
    this.rendering = true;
    this.dirty = false;
    this.lastFrame = timeToFrame(t, seq.fps);
    this.lastSeq = seq;
    this.compositor
      .render(seq, t, { media: this.getMedia, frames: this.cache, mode, showSafeMargins: this.safeMargins })
      .then(
        () => {
          this.rendered++;
          this.failures = 0;
          // a lost context resolves without drawing anything, which looks
          // exactly like the blank monitor nobody could get back
          this.setProblem(this.compositor.contextLost ? 'the preview lost its graphics context' : null);
        },
        (e: unknown) => {
          this.failures++;
          if (!this.warned) {
            this.warned = true;
            console.warn('[braincut] render failed:', e);
          }
          if (this.failures >= 2) this.setProblem(e instanceof Error ? e.message : String(e));
        }
      )
      .finally(() => {
        this.rendering = false;
        if (!this.isPlaying && !this.destroyed && (this.dirty || this.pendingSeek !== null)) this.schedule();
      });
  }

  // warms the decoder of whatever starts within the next moment, so a cut
  // doesn't stall on a cold seek
  private prefetch(seq: Sequence, t: number): void {
    for (const track of seq.tracks) {
      if (track.kind !== 'video' || track.hidden) continue;
      const next = track.clips.find((c) => c.start > t && c.start <= t + PREFETCH_AHEAD);
      if (!next || !next.enabled || next.kind !== 'video' || !next.mediaId) continue;
      const media = this.getMedia(next.mediaId);
      if (!media || media.status !== 'ready') continue;
      this.cache.prefetch(media, sourceTimeAt(next, next.start, media.duration), next.id);
    }
  }
}
