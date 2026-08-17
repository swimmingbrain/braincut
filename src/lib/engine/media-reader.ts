import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny';
import type { MediaItem, Rotation } from '$lib/project/types';

// one decoded picture, handed to the compositor for exactly one draw. release
// closes whatever must be closed, the reader keeps its own copy in the cache
export interface FrameHandle {
  image: VideoFrame | ImageBitmap | OffscreenCanvas;
  // square pixel size before the rotation metadata is applied
  width: number;
  height: number;
  timestamp: number;
  // rotation metadata of the file the picture came from, a proxy may differ
  // from the original when the conversion baked the rotation in
  rotation?: Rotation;
  release(): void;
}

export interface VideoCursor {
  frameAt(t: number): Promise<FrameHandle | null>;
  close(): void;
}

export type DecoderPreference = 'no-preference' | 'prefer-hardware' | 'prefer-software';

let decoderPreference: DecoderPreference = 'no-preference';

// applies to readers opened from now on, the media cache drops the open ones
// when the preference changes
export function setDecoderPreference(pref: DecoderPreference): void {
  decoderPreference = pref;
}

// random access keeps this many decoded frames around, enough for scrubbing
// back and forth over a cut without touching the decoder. hardware decoders
// hand out frames from a small pool and stop producing while too many are
// held, so this stays well under the pool together with the sink's queue
const FRAME_CACHE = 4;
// a scrub request this far ahead of the last decoded frame keeps pulling from
// the running iterator instead of seeking, seeking always goes back to a keyframe
const SCRUB_WINDOW = 1;
// the playback cursor decodes this many frames ahead of the playhead
const READ_AHEAD = 4;
// a jump further than this restarts the playback cursor instead of decoding through
const CURSOR_JUMP = 1.5;
const MAX_PULLS = 600;

function sampleEnd(sample: VideoSample, fps: number): number {
  return sample.timestamp + (sample.duration > 0 ? sample.duration : 1 / fps);
}

function closeQuietly(sample: VideoSample | null | undefined): void {
  if (!sample) return;
  try {
    sample.close();
  } catch {}
}

function makeHandle(sample: VideoSample, rotation: Rotation): FrameHandle | null {
  let frame: VideoFrame;
  try {
    frame = sample.toVideoFrame();
  } catch {
    return null;
  }
  return {
    image: frame,
    width: sample.squarePixelWidth || sample.codedWidth,
    height: sample.squarePixelHeight || sample.codedHeight,
    timestamp: sample.timestamp,
    rotation,
    release: () => {
      try {
        frame.close();
      } catch {}
    }
  };
}

// serializes async work on one decoder: iterators can't be pulled from two
// places at once, and a seek must not overlap a running pull
class Chain {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

class Cursor implements VideoCursor {
  private iter: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private current: VideoSample | null = null;
  private queue: VideoSample[] = [];
  private ended = false;
  private closed = false;
  private newest = -Infinity;
  private readonly chain = new Chain();
  private filling = false;

  constructor(
    private readonly sink: VideoSampleSink,
    private readonly fps: number,
    private readonly duration: number,
    private readonly rotation: Rotation,
    private readonly onClose: (c: Cursor) => void
  ) {}

  frameAt(t: number): Promise<FrameHandle | null> {
    if (this.closed) return Promise.resolve(null);
    const time = Math.max(0, Math.min(t, this.duration));
    return this.chain.run(() => this.advance(time));
  }

  private async advance(t: number): Promise<FrameHandle | null> {
    const tol = 0.5 / this.fps;
    const backwards = this.current !== null && t < this.current.timestamp - tol;
    const farAhead = this.newest !== -Infinity && t > this.newest + CURSOR_JUMP;
    if (!this.iter || backwards || farAhead) this.restart(t);

    for (let pulls = 0; pulls < MAX_PULLS; pulls++) {
      if (this.closed) return null;
      // move the queue forward to the newest sample that starts at or before t
      while (this.queue.length > 0 && this.queue[0].timestamp <= t + tol) {
        closeQuietly(this.current);
        this.current = this.queue.shift()!;
      }
      const cur = this.current;
      if (cur) {
        const covers = sampleEnd(cur, this.fps) > t + tol;
        const nextStartsLater = this.queue.length > 0 && this.queue[0].timestamp > t + tol;
        if (covers || nextStartsLater || this.ended) break;
      } else if (this.ended) {
        return null;
      }
      const got = await this.pull();
      if (!got && this.ended) break;
    }

    this.fill();
    return this.current ? makeHandle(this.current, this.rotation) : null;
  }

  private restart(t: number): void {
    const old = this.iter;
    if (old) void old.return().catch(() => {});
    for (const s of this.queue) closeQuietly(s);
    this.queue = [];
    closeQuietly(this.current);
    this.current = null;
    this.ended = false;
    this.newest = -Infinity;
    this.iter = this.sink.samples(t);
  }

  // pulls one sample from the iterator into the queue
  private async pull(): Promise<boolean> {
    const iter = this.iter;
    if (!iter || this.ended) return false;
    let result: IteratorResult<VideoSample, void>;
    try {
      result = await iter.next();
    } catch {
      if (this.iter === iter) this.ended = true;
      return false;
    }
    if (this.iter !== iter || this.closed) {
      if (!result.done) closeQuietly(result.value);
      return false;
    }
    if (result.done) {
      this.ended = true;
      return false;
    }
    this.queue.push(result.value);
    this.newest = result.value.timestamp;
    return true;
  }

  // read ahead in the background so the next frameAt finds its sample waiting
  private fill(): void {
    if (this.filling || this.ended || this.closed) return;
    this.filling = true;
    void this.chain.run(async () => {
      try {
        while (!this.closed && !this.ended && this.queue.length < READ_AHEAD) {
          if (!(await this.pull())) break;
        }
      } finally {
        this.filling = false;
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const iter = this.iter;
    this.iter = null;
    if (iter) void iter.return().catch(() => {});
    for (const s of this.queue) closeQuietly(s);
    this.queue = [];
    closeQuietly(this.current);
    this.current = null;
    this.onClose(this);
  }
}

interface CachedSample {
  sample: VideoSample;
  used: number;
}

export class MediaReader {
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  // rotation metadata of the file, the compositor applies it when drawing
  readonly rotation: Rotation;
  // size after rotation and aspect ratio correction, what the viewer sees
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly fps: number;
  readonly duration: number;

  private readonly cache: CachedSample[] = [];
  private tick = 0;
  private scrub: { iter: AsyncGenerator<VideoSample, void, unknown>; last: number } | null = null;
  private readonly chain = new Chain();
  private readonly cursors = new Set<Cursor>();
  private closed = false;

  private constructor(
    readonly media: MediaItem,
    private readonly input: Input,
    private readonly videoSink: VideoSampleSink | null,
    private readonly audioSink: AudioBufferSink | null,
    info: { rotation: Rotation; displayWidth: number; displayHeight: number; codedWidth: number; codedHeight: number; fps: number; duration: number }
  ) {
    this.hasVideo = videoSink !== null;
    this.hasAudio = audioSink !== null;
    this.rotation = info.rotation;
    this.displayWidth = info.displayWidth;
    this.displayHeight = info.displayHeight;
    this.codedWidth = info.codedWidth;
    this.codedHeight = info.codedHeight;
    this.fps = info.fps;
    this.duration = info.duration;
  }

  static async open(media: MediaItem, blob: Blob): Promise<MediaReader> {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const wantVideo = media.kind !== 'audio';
      const [videoTrack, audioTrack] = await Promise.all([
        wantVideo ? input.getPrimaryVideoTrack() : Promise.resolve(null),
        input.getPrimaryAudioTrack()
      ]);

      let videoSink: VideoSampleSink | null = null;
      const info = {
        rotation: media.rotation,
        displayWidth: media.width,
        displayHeight: media.height,
        codedWidth: media.width,
        codedHeight: media.height,
        fps: media.fps && media.fps > 0 ? media.fps : 30,
        duration: media.duration
      };
      if (videoTrack && (await videoTrack.canDecode())) {
        videoSink = new VideoSampleSink(videoTrack, { hardwareAcceleration: decoderPreference });
        const [rotation, displayWidth, displayHeight, codedWidth, codedHeight] = await Promise.all([
          videoTrack.getRotation(),
          videoTrack.getDisplayWidth(),
          videoTrack.getDisplayHeight(),
          videoTrack.getCodedWidth(),
          videoTrack.getCodedHeight()
        ]);
        info.rotation = rotation;
        info.displayWidth = displayWidth;
        info.displayHeight = displayHeight;
        info.codedWidth = codedWidth;
        info.codedHeight = codedHeight;
        if (info.duration <= 0) info.duration = await videoTrack.computeDuration();
      }

      let audioSink: AudioBufferSink | null = null;
      if (audioTrack && (await audioTrack.canDecode())) {
        audioSink = new AudioBufferSink(audioTrack);
        if (info.duration <= 0) info.duration = await audioTrack.computeDuration();
      }

      if (!videoSink && !audioSink) {
        throw new Error(`Nothing in ${media.name} can be decoded by this browser`);
      }
      return new MediaReader(media, input, videoSink, audioSink, info);
    } catch (e) {
      input.dispose();
      throw e;
    }
  }

  // random access for scrubbing and export. consecutive requests that move
  // forward a little share one iterator, everything else seeks
  frameAt(time: number): Promise<FrameHandle | null> {
    if (this.closed || !this.videoSink) return Promise.resolve(null);
    const t = Math.max(0, Math.min(time, this.duration));
    return this.chain.run(() => this.randomAccess(t));
  }

  private async randomAccess(t: number): Promise<FrameHandle | null> {
    const hit = this.lookup(t);
    if (hit) return makeHandle(hit, this.rotation);

    const sink = this.videoSink!;
    const reuse = this.scrub !== null && t >= this.scrub.last && t - this.scrub.last < SCRUB_WINDOW;
    if (!reuse) {
      this.dropScrub();
      this.scrub = { iter: sink.samples(t), last: t };
    }
    const scrub = this.scrub!;
    let best: VideoSample | null = null;
    for (let pulls = 0; pulls < MAX_PULLS; pulls++) {
      let result: IteratorResult<VideoSample, void>;
      try {
        result = await scrub.iter.next();
      } catch {
        if (this.scrub === scrub) this.scrub = null;
        break;
      }
      if (this.closed) {
        if (!result.done) closeQuietly(result.value);
        return null;
      }
      if (result.done) {
        if (this.scrub === scrub) this.scrub = null;
        break;
      }
      const sample = result.value;
      scrub.last = sample.timestamp;
      this.remember(sample);
      if (sample.timestamp > t + 0.5 / this.fps) {
        // the frame before this one covers t, or this is the first frame of the file
        break;
      }
      best = sample;
      if (sampleEnd(sample, this.fps) > t + 0.5 / this.fps) break;
    }
    const chosen = best ?? this.lookup(t) ?? this.newestBefore(t);
    return chosen ? makeHandle(chosen, this.rotation) : null;
  }

  private lookup(t: number): VideoSample | null {
    const tol = 0.5 / this.fps;
    for (const entry of this.cache) {
      const s = entry.sample;
      if (s.timestamp <= t + tol && sampleEnd(s, this.fps) > t + tol) {
        entry.used = ++this.tick;
        return s;
      }
    }
    return null;
  }

  private newestBefore(t: number): VideoSample | null {
    let best: CachedSample | null = null;
    for (const entry of this.cache) {
      if (entry.sample.timestamp <= t && (!best || entry.sample.timestamp > best.sample.timestamp)) best = entry;
    }
    if (best) best.used = ++this.tick;
    return best?.sample ?? null;
  }

  private remember(sample: VideoSample): void {
    const existing = this.cache.find((e) => e.sample.timestamp === sample.timestamp);
    if (existing) {
      closeQuietly(existing.sample);
      existing.sample = sample;
      existing.used = ++this.tick;
      return;
    }
    this.cache.push({ sample, used: ++this.tick });
    while (this.cache.length > FRAME_CACHE) {
      let oldest = 0;
      for (let i = 1; i < this.cache.length; i++) {
        if (this.cache[i].used < this.cache[oldest].used) oldest = i;
      }
      closeQuietly(this.cache[oldest].sample);
      this.cache.splice(oldest, 1);
    }
  }

  private dropScrub(): void {
    const scrub = this.scrub;
    this.scrub = null;
    if (scrub) void scrub.iter.return().catch(() => {});
  }

  // sequential decoding for playback, cheap as long as t keeps increasing
  cursor(): VideoCursor {
    if (this.closed || !this.videoSink) {
      return { frameAt: () => Promise.resolve(null), close: () => {} };
    }
    const cursor = new Cursor(this.videoSink, this.fps, this.duration, this.rotation, (c) => this.cursors.delete(c));
    this.cursors.add(cursor);
    return cursor;
  }

  async *audio(start: number, end: number): AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }> {
    if (this.closed || !this.audioSink) return;
    if (end <= start) return;
    for await (const chunk of this.audioSink.buffers(Math.max(0, start), end)) {
      if (this.closed) return;
      yield { buffer: chunk.buffer, timestamp: chunk.timestamp };
    }
  }

  stats(): { frames: number; cursors: number } {
    return { frames: this.cache.length, cursors: this.cursors.size };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const cursor of Array.from(this.cursors)) cursor.close();
    this.dropScrub();
    for (const entry of this.cache) closeQuietly(entry.sample);
    this.cache.length = 0;
    try {
      this.input.dispose();
    } catch {}
  }
}
