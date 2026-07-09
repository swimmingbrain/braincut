// audio effect type to a small web audio graph. everything here is built
// from plain nodes so the same chain renders in an offline context for the
// export, where worklets are not an option
import type { ParamValue } from '$lib/project/types';

export interface AudioEffectRuntime {
  input: AudioNode;
  output: AudioNode;
  update(params: Record<string, ParamValue>, time: number): void;
  destroy(): void;
}

type Params = Record<string, ParamValue>;

function num(p: Params, key: string, fallback: number): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function str(p: Params, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
}

export function dbToGain(db: number): number {
  return db <= -60 ? 0 : Math.pow(10, db / 20);
}

// setting a-rate params through setTargetAtTime avoids the zipper noise a
// direct assignment makes while a fader is dragged, and is harmless offline
function ramp(param: AudioParam, value: number, ctx: BaseAudioContext, time: number, seconds = 0.02): void {
  const at = Math.max(ctx.currentTime, time);
  param.setTargetAtTime(value, at, seconds);
}

function chain(...nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}

function disconnectAll(nodes: AudioNode[]): void {
  for (const n of nodes) n.disconnect();
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = 1, gain = 0): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  node.gain.value = gain;
  return node;
}

// a burst of noise fading out exponentially sounds close enough to a room,
// and costs nothing to make compared to shipping impulse files
export function makeImpulse(ctx: BaseAudioContext, duration: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * duration));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

function wetDry(ctx: BaseAudioContext, wet: AudioNode, wetInput: AudioNode = wet): AudioEffectRuntime & { dry: GainNode; wetGain: GainNode } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wetGain = ctx.createGain();
  input.connect(dry);
  dry.connect(output);
  input.connect(wetInput);
  wet.connect(wetGain);
  wetGain.connect(output);
  return {
    input, output, dry, wetGain,
    update: () => {},
    destroy: () => disconnectAll([input, output, dry, wetGain, wet, wetInput])
  };
}

const factories: Record<string, (ctx: BaseAudioContext) => AudioEffectRuntime> = {
  gain: (ctx) => {
    const node = ctx.createGain();
    return {
      input: node, output: node,
      update: (p, t) => ramp(node.gain, dbToGain(num(p, 'gain', 0)), ctx, t),
      destroy: () => node.disconnect()
    };
  },

  equalizer: (ctx) => {
    const low = biquad(ctx, 'lowshelf', 100);
    const mid = biquad(ctx, 'peaking', 1000, 1);
    const high = biquad(ctx, 'highshelf', 8000);
    chain(low, mid, high);
    return {
      input: low, output: high,
      update: (p, t) => {
        ramp(low.gain, num(p, 'low', 0), ctx, t);
        ramp(mid.gain, num(p, 'mid', 0), ctx, t);
        ramp(mid.frequency, num(p, 'midFrequency', 1000), ctx, t);
        ramp(mid.Q, num(p, 'midQ', 1), ctx, t);
        ramp(high.gain, num(p, 'high', 0), ctx, t);
      },
      destroy: () => disconnectAll([low, mid, high])
    };
  },

  'low-pass': (ctx) => simpleFilter(ctx, 'lowpass', 4000),
  'high-pass': (ctx) => simpleFilter(ctx, 'highpass', 200),
  'band-pass': (ctx) => simpleFilter(ctx, 'bandpass', 1000),

  compressor: (ctx) => {
    const comp = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();
    comp.connect(makeup);
    return {
      input: comp, output: makeup,
      update: (p, t) => {
        ramp(comp.threshold, num(p, 'threshold', -24), ctx, t);
        ramp(comp.knee, num(p, 'knee', 30), ctx, t);
        ramp(comp.ratio, num(p, 'ratio', 4), ctx, t);
        ramp(comp.attack, num(p, 'attack', 3) / 1000, ctx, t);
        ramp(comp.release, num(p, 'release', 250) / 1000, ctx, t);
        ramp(makeup.gain, dbToGain(num(p, 'makeup', 0)), ctx, t);
      },
      destroy: () => disconnectAll([comp, makeup])
    };
  },

  reverb: (ctx) => {
    const convolver = ctx.createConvolver();
    const rt = wetDry(ctx, convolver);
    let impulseKey = '';
    return {
      ...rt,
      update: (p, t) => {
        const duration = num(p, 'duration', 2);
        const decay = num(p, 'decay', 2);
        const key = `${duration}:${decay}`;
        if (key !== impulseKey) {
          impulseKey = key;
          convolver.buffer = makeImpulse(ctx, duration, decay);
        }
        const mix = num(p, 'mix', 30) / 100;
        ramp(rt.dry.gain, 1 - mix, ctx, t);
        ramp(rt.wetGain.gain, mix, ctx, t);
      }
    };
  },

  delay: (ctx) => {
    const delay = ctx.createDelay(5);
    const feedback = ctx.createGain();
    delay.connect(feedback);
    feedback.connect(delay);
    const rt = wetDry(ctx, delay);
    return {
      ...rt,
      update: (p, t) => {
        ramp(delay.delayTime, Math.min(5, num(p, 'time', 250) / 1000), ctx, t);
        ramp(feedback.gain, Math.min(0.95, num(p, 'feedback', 30) / 100), ctx, t);
        const mix = num(p, 'mix', 30) / 100;
        ramp(rt.dry.gain, 1 - mix, ctx, t);
        ramp(rt.wetGain.gain, mix, ctx, t);
      },
      destroy: () => {
        rt.destroy();
        feedback.disconnect();
      }
    };
  },

  // mid/side: width scales the difference between the channels, so 0 is
  // mono, 100 leaves it alone and 200 pushes the sides out
  'stereo-width': (ctx) => {
    const input = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const output = ctx.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    // left out = mid + side = l*(1+w)/2 + r*(1-w)/2, right out = l*(1-w)/2 + r*(1+w)/2
    const ll = ctx.createGain();
    const lr = ctx.createGain();
    const rl = ctx.createGain();
    const rr = ctx.createGain();
    input.connect(splitter);
    splitter.connect(ll, 0);
    splitter.connect(lr, 0);
    splitter.connect(rl, 1);
    splitter.connect(rr, 1);
    ll.connect(merger, 0, 0);
    rl.connect(merger, 0, 0);
    lr.connect(merger, 0, 1);
    rr.connect(merger, 0, 1);
    merger.connect(output);
    return {
      input, output,
      update: (p, t) => {
        const w = Math.max(0, num(p, 'width', 100) / 100);
        const same = (1 + w) / 2;
        const cross = (1 - w) / 2;
        ramp(ll.gain, same, ctx, t);
        ramp(rr.gain, same, ctx, t);
        ramp(lr.gain, cross, ctx, t);
        ramp(rl.gain, cross, ctx, t);
      },
      destroy: () => disconnectAll([input, splitter, merger, output, ll, lr, rl, rr])
    };
  },

  'mute-channel': (ctx) => {
    const input = ctx.createGain();
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const output = ctx.createGain();
    const left = ctx.createGain();
    const right = ctx.createGain();
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);
    left.connect(merger, 0, 0);
    right.connect(merger, 0, 1);
    merger.connect(output);
    return {
      input, output,
      update: (p, t) => {
        const channel = str(p, 'channel', 'left');
        ramp(left.gain, channel === 'left' ? 0 : 1, ctx, t);
        ramp(right.gain, channel === 'right' ? 0 : 1, ctx, t);
      },
      destroy: () => disconnectAll([input, splitter, merger, output, left, right])
    };
  }
};

function simpleFilter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number): AudioEffectRuntime {
  const node = biquad(ctx, type, frequency);
  return {
    input: node, output: node,
    update: (p, t) => {
      ramp(node.frequency, num(p, 'frequency', frequency), ctx, t);
      ramp(node.Q, num(p, 'q', 1), ctx, t);
    },
    destroy: () => node.disconnect()
  };
}

// volume and pan are the audio engine's own business (keyframed gain and
// the stereo panner it owns per clip), so they get no chain here
export function createAudioEffect(ctx: BaseAudioContext, type: string): AudioEffectRuntime | null {
  const factory = factories[type];
  return factory ? factory(ctx) : null;
}

export function hasAudioEffectRuntime(type: string): boolean {
  return type in factories;
}
