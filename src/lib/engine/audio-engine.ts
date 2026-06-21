import { writable, type Readable } from 'svelte/store';
import type { Clip, Id, MediaItem, Sequence, Track } from '$lib/project/types';
import type { MediaCache } from './media-cache';
import { buildClipChain, clipAudio, mergePieces, scheduleBuffer, trimPiece, volumeAt, type AudioPiece, type ClipChain } from './audio-graph';
import { chunkSequenceEnd, dbToGain, gainToDb, sourceWindow } from './audio-math';
import { clipEnd, sourceTimeAt } from './clip-time';

// how often the scheduler looks for work and how far ahead it schedules
const TICK_MS = 250;
const LOOKAHEAD = 1.5;
// scheduling starts this far into the future so the first pieces aren't late
const START_LATENCY = 0.06;
// faster than this, or backwards, is video only
const MAX_AUDIBLE_RATE = 4;
const SCRUB_SLICE = 0.08;
const METER_FLOOR = -60;

export type Levels = Record<Id, [number, number]>;

interface Meter {
  splitter: ChannelSplitterNode;
  left: AnalyserNode;
  right: AnalyserNode;
}

interface TrackNodes {
  gain: GainNode;
  meter: Meter;
}

interface ClipStream {
  clip: Clip;
  track: Track;
  chain: ClipChain;
  pieces: AsyncGenerator<AudioPiece> | null;
  // sequence time up to which sound is on the graph
  scheduledTo: number;
  pumping: boolean;
  done: boolean;
  sources: Set<AudioBufferSourceNode>;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  // per track and 'master', in db, refreshed on animation frames while playing
  readonly levels: Readable<Levels>;

  private readonly master: GainNode;
  private readonly masterMeter: Meter;
  private readonly tracks = new Map<Id, TrackNodes>();
  private readonly streams = new Map<Id, ClipStream>();
  private readonly levelsStore = writable<Levels>({});
  private readonly sample = new Float32Array(256);

  private sequence: Sequence | null = null;
  private getMedia: (id: Id) => MediaItem | undefined = () => undefined;
  private cache: MediaCache | null = null;
  private running = false;
  private session = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private rate = 1;
  private seqStart = 0;
  private ctxStart = 0;
  private perfStart = 0;
  private lastTime = 0;
  private scrubbing = false;
  private warned = false;
  private destroyed = false;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.masterMeter = this.makeMeter(this.master);
    this.master.connect(this.ctx.destination);
    this.levels = { subscribe: this.levelsStore.subscribe };
  }

  private makeMeter(node: AudioNode): Meter {
    const splitter = this.ctx.createChannelSplitter(2);
    const left = this.ctx.createAnalyser();
    const right = this.ctx.createAnalyser();
    left.fftSize = 256;
    right.fftSize = 256;
    node.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    return { splitter, left, right };
  }

  private peakDb(analyser: AnalyserNode): number {
    analyser.getFloatTimeDomainData(this.sample);
    let peak = 0;
    for (let i = 0; i < this.sample.length; i++) {
      const v = Math.abs(this.sample[i]);
      if (v > peak) peak = v;
    }
    return Math.max(METER_FLOOR, gainToDb(peak));
  }

  getLevels(): Levels {
    const out: Levels = { master: [this.peakDb(this.masterMeter.left), this.peakDb(this.masterMeter.right)] };
    for (const [id, t] of this.tracks) out[id] = [this.peakDb(t.meter.left), this.peakDb(t.meter.right)];
    return out;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // the transport clock in sequence seconds. the audio context drives it,
  // with a wall clock standing in until the context is allowed to run
  currentTime(): number {
    if (!this.running) return this.lastTime;
    const elapsed = this.ctx.state === 'running'
      ? this.ctx.currentTime - this.ctxStart
      : (performance.now() - this.perfStart) / 1000;
    this.lastTime = this.seqStart + elapsed * this.rate;
    return this.lastTime;
  }

  private seqToCtx(seq: number): number {
    return this.ctxStart + (seq - this.seqStart) / this.rate;
  }

  private get audible(): boolean {
    return this.rate > 0 && this.rate <= MAX_AUDIBLE_RATE;
  }

  start(sequence: Sequence, getMedia: (id: Id) => MediaItem | undefined, cache: MediaCache, fromTime: number, rate = 1): void {
    if (this.destroyed) return;
    this.stopStreams();
    this.sequence = sequence;
    this.getMedia = getMedia;
    this.cache = cache;
    this.rate = rate === 0 ? 1 : rate;
    this.seqStart = fromTime;
    this.lastTime = fromTime;
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    this.ctxStart = this.ctx.currentTime + START_LATENCY;
    this.perfStart = performance.now() + START_LATENCY * 1000;
    this.running = true;
    this.session++;
    if (this.timer === null) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.meterLoop();
  }

  stop(): void {
    if (!this.running) return;
    this.lastTime = this.currentTime();
    this.running = false;
    this.session++;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopStreams();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.levelsStore.set({});
  }

  seek(time: number): void {
    if (!this.running || !this.sequence || !this.cache) {
      this.lastTime = time;
      return;
    }
    this.start(this.sequence, this.getMedia, this.cache, time, this.rate);
  }

  setRate(rate: number): void {
    if (!this.running) {
      this.rate = rate === 0 ? 1 : rate;
      return;
    }
    this.seek(this.currentTime());
  }

  // the sequence changed under a running transport: same clock, new sound
  update(sequence: Sequence): void {
    this.sequence = sequence;
    if (this.running) this.restartFrom(this.currentTime());
  }

  restartFrom(time: number): void {
    if (!this.running) return;
    this.stopStreams();
    this.session++;
    this.lastTime = time;
    this.tick();
  }

  private stopStreams(): void {
    for (const stream of this.streams.values()) this.closeStream(stream);
    this.streams.clear();
  }

  private closeStream(stream: ClipStream): void {
    stream.done = true;
    if (stream.pieces) void stream.pieces.return(undefined).catch(() => {});
    stream.pieces = null;
    for (const s of stream.sources) {
      try {
        s.stop();
      } catch {}
      s.disconnect();
    }
    stream.sources.clear();
    stream.chain.destroy();
  }

  private trackNodes(track: Track): TrackNodes {
    let nodes = this.tracks.get(track.id);
    if (!nodes) {
      const gain = this.ctx.createGain();
      const meter = this.makeMeter(gain);
      gain.connect(this.master);
      nodes = { gain, meter };
      this.tracks.set(track.id, nodes);
    }
    return nodes;
  }

  private audioTracks(sequence: Sequence): Track[] {
    const tracks = sequence.tracks.filter((t) => t.kind === 'audio');
    const solo = tracks.some((t) => t.solo);
    return tracks.filter((t) => (solo ? t.solo : true));
  }

  private tick(): void {
    if (!this.running || !this.sequence || !this.cache) return;
    try {
      const sequence = this.sequence;
      const now = this.currentTime();
      const horizon = now + LOOKAHEAD * Math.abs(this.rate);
      const live = new Set<Id>();

      for (const track of sequence.tracks) {
        if (track.kind !== 'audio') continue;
        const nodes = this.trackNodes(track);
        nodes.gain.gain.value = track.muted ? 0 : dbToGain(track.volume);
      }
      if (this.audible) {
        for (const track of this.audioTracks(sequence)) {
          if (track.muted) continue;
          for (const clip of track.clips) {
            if (!clip.enabled || clip.kind !== 'audio' || !clip.mediaId) continue;
            if (clipEnd(clip) <= now || clip.start >= horizon) continue;
            live.add(clip.id);
            let stream = this.streams.get(clip.id);
            if (!stream) {
              stream = {
                clip,
                track,
                chain: buildClipChain(this.ctx, clip, this.trackNodes(track).gain),
                pieces: null,
                scheduledTo: Math.max(now, clip.start),
                pumping: false,
                done: false,
                sources: new Set()
              };
              this.streams.set(clip.id, stream);
            }
            if (!stream.done && !stream.pumping && stream.scheduledTo < horizon) void this.pump(stream, this.session);
          }
        }
      }
      for (const [id, stream] of this.streams) {
        if (!live.has(id) && clipEnd(stream.clip) < now - 0.5) {
          this.closeStream(stream);
          this.streams.delete(id);
        }
      }
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        console.warn('[braincut] audio scheduling failed:', e);
      }
    }
  }

  private async pump(stream: ClipStream, session: number): Promise<void> {
    stream.pumping = true;
    try {
      const cache = this.cache;
      const media = stream.clip.mediaId ? this.getMedia(stream.clip.mediaId) : undefined;
      if (!cache || !media || media.status !== 'ready') {
        stream.done = true;
        return;
      }
      if (!stream.pieces) {
        const reader = await cache.reader(media);
        if (session !== this.session) return;
        if (!reader || !reader.hasAudio) {
          stream.done = true;
          return;
        }
        const window = sourceWindow(stream.clip, stream.scheduledTo, clipEnd(stream.clip), media.duration);
        stream.pieces = clipAudio(reader, stream.clip, this.ctx, window);
      }
      const clock = { seqToCtx: (t: number) => this.seqToCtx(t), rate: this.rate };
      while (session === this.session && stream.scheduledTo < this.currentTime() + LOOKAHEAD * Math.abs(this.rate)) {
        const next = await stream.pieces.next();
        if (session !== this.session) return;
        if (next.done) {
          stream.done = true;
          return;
        }
        const piece = next.value;
        const node = scheduleBuffer(this.ctx, stream.chain, stream.clip, stream.track, piece.buffer, piece.timestamp, clock);
        if (node) {
          stream.sources.add(node);
          node.onended = () => {
            stream.sources.delete(node);
            node.disconnect();
          };
        }
        stream.scheduledTo = Math.max(stream.scheduledTo, chunkSequenceEnd(stream.clip, piece.timestamp, piece.buffer.duration));
      }
    } catch (e) {
      stream.done = true;
      if (!this.warned) {
        this.warned = true;
        console.warn('[braincut] audio decoding failed:', e);
      }
    } finally {
      stream.pumping = false;
    }
  }

  private meterLoop(): void {
    if (this.raf) return;
    const step = () => {
      this.raf = 0;
      if (!this.running || this.destroyed) return;
      this.levelsStore.set(this.getLevels());
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  // a short slice of what sits under the playhead, for scrubbing with sound
  async scrubTo(sequence: Sequence, getMedia: (id: Id) => MediaItem | undefined, cache: MediaCache, time: number): Promise<void> {
    if (this.destroyed || this.running || this.scrubbing) return;
    this.scrubbing = true;
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
      const when = this.ctx.currentTime + 0.02;
      const jobs: Promise<void>[] = [];
      for (const track of this.audioTracks(sequence)) {
        if (track.muted) continue;
        const nodes = this.trackNodes(track);
        nodes.gain.gain.value = dbToGain(track.volume);
        for (const clip of track.clips) {
          if (!clip.enabled || clip.kind !== 'audio' || !clip.mediaId) continue;
          if (time < clip.start || time >= clipEnd(clip)) continue;
          const media = getMedia(clip.mediaId);
          if (!media || media.status !== 'ready') continue;
          jobs.push(this.playSlice(clip, media, cache, time, nodes.gain, when));
        }
      }
      await Promise.all(jobs);
    } catch {
      // a failed scrub is silent, nothing to tell anyone
    } finally {
      this.scrubbing = false;
    }
  }

  private async playSlice(clip: Clip, media: MediaItem, cache: MediaCache, time: number, destination: AudioNode, when: number): Promise<void> {
    const reader = await cache.reader(media);
    if (!reader || !reader.hasAudio) return;
    const src = sourceTimeAt(clip, time, media.duration);
    const pieces: AudioPiece[] = [];
    for await (const chunk of reader.audio(src, src + SCRUB_SLICE * clip.speed)) pieces.push(chunk);
    const merged = mergePieces(this.ctx, pieces);
    if (!merged) return;
    const slice = trimPiece(this.ctx, merged, src, src + SCRUB_SLICE * clip.speed) ?? merged;
    const gain = this.ctx.createGain();
    gain.gain.value = volumeAt(clip, time - clip.start);
    gain.connect(destination);
    const source = this.ctx.createBufferSource();
    source.buffer = slice.buffer;
    source.connect(gain);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start(Math.max(when, this.ctx.currentTime));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    for (const t of this.tracks.values()) t.gain.disconnect();
    this.tracks.clear();
    this.master.disconnect();
    void this.ctx.close().catch(() => {});
  }
}
