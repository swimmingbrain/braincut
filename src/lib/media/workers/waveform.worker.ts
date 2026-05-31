import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';

// decodes the whole audio track once and keeps a min/max pair per bucket,
// mixed down to mono. the main thread only ever sees the finished peaks

export type WorkerRequest =
  | { type: 'compute'; id: number; blob: Blob; perSecond: number }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'progress'; id: number; value: number }
  | { type: 'done'; id: number; peaks: Float32Array }
  | { type: 'error'; id: number; message: string };

const cancelled = new Set<number>();

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(message, transfer);
}

async function compute(id: number, blob: Blob, perSecond: number) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) throw new Error('No decodable audio track');
    const duration = await input.computeDuration([track]).catch(async () => (await input.getDurationFromMetadata([track])) ?? 0);
    let buckets = Math.ceil(Math.max(duration, 1) * perSecond) + 1;
    // min starts high and max low, so the first sample of a bucket wins
    let peaks = new Float32Array(buckets * 2);
    for (let b = 0; b < buckets; b++) { peaks[b * 2] = 1; peaks[b * 2 + 1] = -1; }

    const grow = (needed: number) => {
      if (needed <= buckets) return;
      const next = new Float32Array(needed * 2);
      next.set(peaks);
      for (let b = buckets; b < needed; b++) { next[b * 2] = 1; next[b * 2 + 1] = -1; }
      peaks = next;
      buckets = needed;
    };

    const sink = new AudioSampleSink(track);
    let lastProgress = 0;
    let plane = new Float32Array(0);
    let mono = new Float32Array(0);
    for await (const sample of sink.samples()) {
      try {
        if (cancelled.has(id)) return;
        const frames = sample.numberOfFrames;
        const channels = sample.numberOfChannels;
        const rate = sample.sampleRate;
        const size = sample.allocationSize({ planeIndex: 0, format: 'f32' });
        if (plane.length * 4 < size) plane = new Float32Array(size / 4);
        if (mono.length < frames) mono = new Float32Array(frames);
        mono.fill(0, 0, frames);
        const scale = 1 / channels;
        for (let c = 0; c < channels; c++) {
          sample.copyTo(plane, { planeIndex: c, format: 'f32' });
          for (let i = 0; i < frames; i++) mono[i] += plane[i] * scale;
        }
        const firstFrame = Math.round(sample.timestamp * rate);
        grow(Math.ceil((sample.timestamp + sample.duration) * perSecond) + 1);
        for (let i = 0; i < frames; i++) {
          const b = Math.floor(((firstFrame + i) * perSecond) / rate);
          if (b < 0) continue;
          const v = mono[i];
          if (v < peaks[b * 2]) peaks[b * 2] = v;
          if (v > peaks[b * 2 + 1]) peaks[b * 2 + 1] = v;
        }
        if (duration > 0) {
          const progress = Math.min(1, (sample.timestamp + sample.duration) / duration);
          if (progress - lastProgress >= 0.02) {
            lastProgress = progress;
            post({ type: 'progress', id, value: progress });
          }
        }
      } finally {
        sample.close();
      }
    }
    // silent buckets never saw a value, they collapse to zero
    for (let b = 0; b < buckets; b++) {
      if (peaks[b * 2] > peaks[b * 2 + 1]) { peaks[b * 2] = 0; peaks[b * 2 + 1] = 0; }
    }
    if (cancelled.has(id)) return;
    post({ type: 'done', id, peaks }, [peaks.buffer]);
  } catch (e) {
    if (!cancelled.has(id)) post({ type: 'error', id, message: e instanceof Error ? e.message : String(e) });
  } finally {
    cancelled.delete(id);
    input.dispose();
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') cancelled.add(message.id);
  else void compute(message.id, message.blob, message.perSecond);
};
