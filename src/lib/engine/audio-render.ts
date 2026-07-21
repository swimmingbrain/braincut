import type { Id, MediaItem, Sequence, Track } from '$lib/project/types';
import { buildClipChain, clipAudio, scheduleBuffer, type ClockMap } from './audio-graph';
import { dbToGain, sourceWindow } from './audio-math';
import { clipEnd } from './clip-time';
import type { MediaCache } from './media-cache';

// the sequence is rendered in chunks of this many seconds, each in a fresh
// offline context, so a long export never holds more than a few seconds of
// decoded sound. the chunk starts a little early and that part is thrown
// away, which gives reverbs, delays and compressors their memory back
const CHUNK = 4;
const PREROLL = 0.5;
const CHANNELS = 2;

function abortError(): Error {
  const error = new Error('Audio render cancelled');
  error.name = 'AbortError';
  return error;
}

function audibleTracks(sequence: Sequence): Track[] {
  const tracks = sequence.tracks.filter((t) => t.kind === 'audio' && !t.muted);
  const solo = sequence.tracks.some((t) => t.kind === 'audio' && t.solo);
  return solo ? tracks.filter((t) => t.solo) : tracks;
}

// builds the same graph the live engine plays through, but on an offline
// context whose time zero sits at origin. everything before the chunk is
// caught up by scheduleBuffer, everything after it is cut by the render length
async function fillChunk(
  ctx: OfflineAudioContext,
  sequence: Sequence,
  getMedia: (id: Id) => MediaItem | undefined,
  cache: MediaCache,
  origin: number,
  end: number,
  signal: AbortSignal | undefined
): Promise<void> {
  const clock: ClockMap = { seqToCtx: (t) => t - origin, rate: 1 };
  for (const track of audibleTracks(sequence)) {
    const trackGain = ctx.createGain();
    trackGain.gain.value = dbToGain(track.volume);
    trackGain.connect(ctx.destination);
    for (const clip of track.clips) {
      if (!clip.enabled || clip.kind !== 'audio' || !clip.mediaId) continue;
      if (clipEnd(clip) <= origin || clip.start >= end) continue;
      const media = getMedia(clip.mediaId);
      if (!media || media.status !== 'ready') continue;
      const reader = await cache.reader(media);
      if (!reader || !reader.hasAudio) continue;
      const release = cache.hold(media.id);
      try {
        const chain = buildClipChain(ctx, clip, trackGain);
        const window = sourceWindow(clip, origin, end, media.duration);
        for await (const piece of clipAudio(reader, clip, ctx, window)) {
          if (signal?.aborted) throw abortError();
          scheduleBuffer(ctx, chain, clip, track, piece.buffer, piece.timestamp, clock);
        }
      } finally {
        release();
      }
    }
  }
}

export async function renderAudio(
  sequence: Sequence,
  getMedia: (id: Id) => MediaItem | undefined,
  cache: MediaCache,
  range: { start: number; end: number },
  sampleRate: number,
  onBuffer: (buffer: AudioBuffer) => Promise<void>,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void
): Promise<void> {
  const total = Math.max(0, Math.round((range.end - range.start) * sampleRate));
  const chunkFrames = Math.round(CHUNK * sampleRate);
  const prerollFrames = Math.round(PREROLL * sampleRate);
  if (total === 0) {
    onProgress?.(1);
    return;
  }

  // chunk edges are counted in sample frames, seconds would drift over an hour
  for (let done = 0; done < total; done += chunkFrames) {
    if (signal?.aborted) throw abortError();
    const frames = Math.min(chunkFrames, total - done);
    const from = range.start + done / sampleRate;
    const origin = from - prerollFrames / sampleRate;
    const end = from + frames / sampleRate;
    const ctx = new OfflineAudioContext({ numberOfChannels: CHANNELS, length: prerollFrames + frames, sampleRate });
    await fillChunk(ctx, sequence, getMedia, cache, origin, end, signal);
    const rendered = await ctx.startRendering();
    if (signal?.aborted) throw abortError();

    const out = new AudioBuffer({ numberOfChannels: CHANNELS, length: frames, sampleRate });
    for (let c = 0; c < CHANNELS; c++) {
      out.copyToChannel(rendered.getChannelData(c).subarray(prerollFrames, prerollFrames + frames), c, 0);
    }
    await onBuffer(out);
    onProgress?.((done + frames) / total);
  }
}
