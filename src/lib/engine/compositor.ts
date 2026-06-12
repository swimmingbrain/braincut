import 'pixi.js/advanced-blend-modes';
import {
  autoDetectRenderer,
  Container,
  Graphics,
  ImageSource,
  RenderTexture,
  Sprite,
  Texture,
  type BLEND_MODES,
  type Filter,
  type Renderer
} from 'pixi.js';
import type { Clip, EffectInstance, Id, MediaItem, Rotation, Sequence, Track, Transition } from '$lib/project/types';
import { paramsAt } from '$lib/project/keyframes';
import { clipAt } from '$lib/project/ops';
import { createVideoEffect } from '$lib/engine/effects/filters';
import { transitionDef } from '$lib/engine/transitions/registry';
import { createTransitionFilter } from '$lib/engine/transitions/filter';
import type { FrameHandle } from './media-reader';
import type { FrameMode, FrameProvider } from './media-cache';
import { buildTitleText, ensureFontLoaded, titleHash, type TitleView } from './text';
import { computeSpriteTransform, cropRect, readTransform } from './transform';
import { sourceTimeAt } from './clip-time';

export interface RenderContext {
  media: (id: Id) => MediaItem | undefined;
  frames: FrameProvider;
  mode: FrameMode;
  showSafeMargins?: boolean;
}

type VideoEffectRuntime = NonNullable<ReturnType<typeof createVideoEffect>>;
type TransitionFilter = NonNullable<ReturnType<typeof createTransitionFilter>>;

interface Layer {
  node: Container;
  cleanup: () => void;
}

// caches nobody touched for this long are dropped at the end of a render
const CACHE_IDLE = 10000;
const OFFLINE_COLOR = 0x3a0d0d;

const blendModes: Record<string, BLEND_MODES> = {
  normal: 'normal',
  add: 'add',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  difference: 'difference',
  exclusion: 'exclusion',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn'
};

function findEffect(clip: Clip, type: string): EffectInstance | undefined {
  return clip.effects.find((e) => e.type === type);
}

function isVisual(kind: Clip['kind']): boolean {
  return kind !== 'audio';
}

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  // resolves once the gl context exists, render waits for it
  readonly ready: Promise<void>;
  width: number;
  height: number;
  scale: number;

  private renderer: Renderer | null = null;
  private readonly root = new Container();
  private lost = false;
  private destroyed = false;
  private tail: Promise<unknown> = Promise.resolve();

  private readonly effects = new Map<Id, { type: string; runtime: VideoEffectRuntime; used: number }>();
  private readonly titles = new Map<Id, { hash: string; view: TitleView; used: number }>();
  private readonly transitions = new Map<Id, { type: string; filter: TransitionFilter; used: number }>();
  private readonly stills = new Map<Id, { bitmap: ImageBitmap; texture: Texture; used: number }>();
  private rtPool: RenderTexture[] = [];
  private empty: RenderTexture | null = null;
  private safeMargins: Graphics | null = null;

  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
  };
  private readonly onRestored = () => {
    this.lost = false;
    this.dropGpuCaches();
  };

  constructor(opts: { width: number; height: number; scale?: number; background?: number }) {
    this.width = Math.max(1, Math.round(opts.width));
    this.height = Math.max(1, Math.round(opts.height));
    this.scale = opts.scale ?? 1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.width * this.scale);
    this.canvas.height = Math.round(this.height * this.scale);
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.root.scale.set(this.scale);
    this.ready = this.init(opts.background ?? 0x000000);
  }

  private async init(background: number): Promise<void> {
    const renderer = await autoDetectRenderer({
      preference: 'webgl',
      canvas: this.canvas,
      width: this.canvas.width,
      height: this.canvas.height,
      resolution: 1,
      antialias: false,
      background,
      backgroundAlpha: 1,
      clearBeforeRender: true,
      premultipliedAlpha: true,
      // exporters and the frame grab read the canvas after a render
      preserveDrawingBuffer: true,
      // the blend modes beyond add/multiply/screen go through the back buffer
      useBackBuffer: true,
      powerPreference: 'high-performance',
      // every frame texture is destroyed right after it is drawn, the
      // collector would only get in the way of the caches this class keeps
      gcActive: false,
      textureGCActive: false
    });
    if (this.destroyed) {
      renderer.destroy();
      return;
    }
    this.renderer = renderer;
  }

  setSize(width: number, height: number, scale: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const s = Math.max(0.05, scale);
    if (w === this.width && h === this.height && s === this.scale) return;
    this.width = w;
    this.height = h;
    this.scale = s;
    this.root.scale.set(s);
    const cw = Math.max(1, Math.round(w * s));
    const ch = Math.max(1, Math.round(h * s));
    if (this.renderer) this.renderer.resize(cw, ch);
    else {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.dropTargets();
    for (const t of this.titles.values()) t.view.destroy();
    this.titles.clear();
    this.safeMargins?.destroy();
    this.safeMargins = null;
  }

  // renders are serialized, two frames in flight would fight over the scene
  render(sequence: Sequence, time: number, ctx: RenderContext): Promise<void> {
    const run = this.tail.then(() => this.renderFrame(sequence, time, ctx));
    this.tail = run.catch(() => {});
    return run;
  }

  private async renderFrame(sequence: Sequence, time: number, ctx: RenderContext): Promise<void> {
    await this.ready;
    const renderer = this.renderer;
    if (!renderer || this.destroyed || this.lost) return;
    if (sequence.width !== this.width || sequence.height !== this.height) {
      this.setSize(sequence.width, sequence.height, this.scale);
    }

    const cleanups: Array<() => void> = [];
    const usedTargets: RenderTexture[] = [];
    const now = performance.now();
    try {
      const videoTracks = sequence.tracks.filter((t) => t.kind === 'video' && !t.hidden && !t.muted);
      const solo = videoTracks.some((t) => t.solo);
      for (const track of videoTracks) {
        if (solo && !track.solo) continue;
        const transition = this.activeTransition(track, time);
        if (transition) {
          const layer = await this.buildTransition(track, transition, sequence, time, ctx, usedTargets, now);
          if (layer) {
            this.root.addChild(layer.node);
            cleanups.push(layer.cleanup);
          }
          continue;
        }
        const clip = clipAt(track, time);
        if (!clip || !clip.enabled || !isVisual(clip.kind)) continue;
        if (clip.kind === 'adjustment') {
          const snapshot = this.acquireTarget();
          usedTargets.push(snapshot);
          renderer.render({ container: this.root, target: snapshot, clear: true, clearColor: [0, 0, 0, 1] });
          // everything below now lives in the snapshot, the layers stay alive
          // until the end of the frame because their cleanups still run
          this.root.removeChildren();
          const below = new Sprite(snapshot);
          below.setSize(this.width, this.height);
          const layer = this.wrapLayer(clip, below, this.width, this.height, sequence, time, now, () => below.destroy());
          this.root.addChild(layer.node);
          cleanups.push(layer.cleanup);
          continue;
        }
        const layer = await this.buildClipLayer(clip, sequence, time, ctx, now);
        if (layer) {
          this.root.addChild(layer.node);
          cleanups.push(layer.cleanup);
        }
      }

      if (ctx.showSafeMargins && ctx.mode !== 'export') {
        this.root.addChild(this.safeMarginsOverlay());
      }
      if (this.lost || this.destroyed) return;
      renderer.render({ container: this.root });
    } finally {
      this.root.removeChildren();
      for (const c of cleanups) {
        try {
          c();
        } catch {}
      }
      for (const rt of usedTargets) this.rtPool.push(rt);
      this.sweep(now);
    }
  }

  private activeTransition(track: Track, time: number): Transition | null {
    for (const t of track.transitions) {
      if (time >= t.start && time < t.start + t.duration) {
        const def = transitionDef(t.type);
        if (def && def.kind === 'video') return t;
        return null;
      }
    }
    return null;
  }

  // the outgoing clip keeps playing past its cut and the incoming one starts
  // early, both are drawn to their own texture and the filter mixes them
  private async buildTransition(
    track: Track,
    transition: Transition,
    sequence: Sequence,
    time: number,
    ctx: RenderContext,
    usedTargets: RenderTexture[],
    now: number
  ): Promise<Layer | null> {
    const renderer = this.renderer;
    if (!renderer) return null;
    const def = transitionDef(transition.type);
    if (!def) return null;
    let entry = this.transitions.get(transition.id);
    if (!entry || entry.type !== transition.type) {
      if (entry) entry.filter.destroy();
      const filter = createTransitionFilter(transition.type);
      if (!filter) return null;
      entry = { type: transition.type, filter, used: now };
      this.transitions.set(transition.id, entry);
    }
    entry.used = now;

    const outgoing = transition.leftClipId ? track.clips.find((c) => c.id === transition.leftClipId) : undefined;
    const incoming = transition.rightClipId ? track.clips.find((c) => c.id === transition.rightClipId) : undefined;
    const [from, to] = await Promise.all([
      outgoing && outgoing.enabled ? this.buildClipLayer(outgoing, sequence, time, ctx, now) : Promise.resolve(null),
      incoming && incoming.enabled ? this.buildClipLayer(incoming, sequence, time, ctx, now) : Promise.resolve(null)
    ]);
    if (this.lost || this.destroyed) {
      from?.cleanup();
      to?.cleanup();
      return null;
    }

    const toTexture = (layer: Layer | null): Texture => {
      if (!layer) return this.emptyTexture();
      const rt = this.acquireTarget();
      usedTargets.push(rt);
      const stage = new Container();
      stage.scale.set(this.scale);
      stage.addChild(layer.node);
      renderer.render({ container: stage, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
      stage.removeChildren();
      stage.destroy();
      layer.cleanup();
      return rt;
    };
    const fromTex = toTexture(from);
    const toTex = toTexture(to);

    const filter = entry.filter;
    filter.setInputs(fromTex, toTex);
    const progress = transition.duration > 0 ? (time - transition.start) / transition.duration : 1;
    filter.progress = Math.min(1, Math.max(0, progress));
    filter.ratio = this.width / this.height;
    filter.setParams({ ...def.defaultParams, ...transition.params });

    const full = new Sprite(Texture.WHITE);
    full.setSize(this.width, this.height);
    full.filters = [filter as Filter];
    return {
      node: full,
      cleanup: () => {
        full.filters = [];
        full.destroy();
      }
    };
  }

  private async buildClipLayer(clip: Clip, sequence: Sequence, time: number, ctx: RenderContext, now: number): Promise<Layer | null> {
    switch (clip.kind) {
      case 'video':
      case 'image':
        return this.buildMediaLayer(clip, sequence, time, ctx, now);
      case 'title':
        return this.buildTitleLayer(clip, sequence, time, now);
      case 'color': {
        const rect = new Graphics().rect(0, 0, this.width, this.height).fill({ color: clip.color ?? '#000000' });
        return this.wrapLayer(clip, rect, this.width, this.height, sequence, time, now, () => rect.destroy());
      }
      default:
        return null;
    }
  }

  private async buildMediaLayer(clip: Clip, sequence: Sequence, time: number, ctx: RenderContext, now: number): Promise<Layer | null> {
    const media = clip.mediaId ? ctx.media(clip.mediaId) : undefined;
    if (!media || media.status !== 'ready' || (!media.hasVideo && media.kind !== 'image')) {
      const w = media && media.width > 0 ? media.width : this.width;
      const h = media && media.height > 0 ? media.height : this.height;
      const matte = new Graphics().rect(0, 0, w, h).fill({ color: OFFLINE_COLOR });
      return this.wrapLayer(clip, matte, w, h, sequence, time, now, () => matte.destroy());
    }
    const sourceTime = sourceTimeAt(clip, time, media.duration);
    const handle = await ctx.frames.getFrame(media, sourceTime, ctx.mode, clip.id);
    if (!handle) return null;
    if (this.lost || this.destroyed) {
      handle.release();
      return null;
    }

    const mediaW = media.width > 0 ? media.width : handle.width;
    const mediaH = media.height > 0 ? media.height : handle.height;
    const rotation = handle.rotation ?? media.rotation;
    const { texture, owned } = this.textureFor(media, handle, now);
    const sprite = new Sprite(texture);
    // a proxy or a converted copy may be smaller than the original, the
    // sprite is stretched to the size the project knows
    const swap = rotation === 90 || rotation === 270;
    sprite.setSize(swap ? mediaH : mediaW, swap ? mediaW : mediaH);
    this.placeRotated(sprite, rotation, mediaW, mediaH);

    return this.wrapLayer(clip, sprite, mediaW, mediaH, sequence, time, now, () => {
      sprite.destroy();
      if (owned) texture.destroy(true);
      handle.release();
    });
  }

  private textureFor(media: MediaItem, handle: FrameHandle, now: number): { texture: Texture; owned: boolean } {
    const image = handle.image;
    if (image instanceof ImageBitmap) {
      const cached = this.stills.get(media.id);
      if (cached && cached.bitmap === image) {
        cached.used = now;
        return { texture: cached.texture, owned: false };
      }
      if (cached) cached.texture.destroy(true);
      const texture = new Texture({
        source: new ImageSource({ resource: image, width: image.width, height: image.height, autoGarbageCollect: false })
      });
      this.stills.set(media.id, { bitmap: image, texture, used: now });
      return { texture, owned: false };
    }
    const texture = new Texture({
      source: new ImageSource({ resource: image, width: handle.width, height: handle.height, autoGarbageCollect: false })
    });
    return { texture, owned: true };
  }

  // decoded pictures come unrotated, the sprite is turned so its box lands
  // on the display size at the origin
  private placeRotated(sprite: Sprite, rotation: Rotation, mediaW: number, mediaH: number): void {
    sprite.rotation = (rotation * Math.PI) / 180;
    switch (rotation) {
      case 90:
        sprite.position.set(mediaW, 0);
        break;
      case 180:
        sprite.position.set(mediaW, mediaH);
        break;
      case 270:
        sprite.position.set(0, mediaH);
        break;
      default:
        sprite.position.set(0, 0);
    }
  }

  private async buildTitleLayer(clip: Clip, sequence: Sequence, time: number, now: number): Promise<Layer | null> {
    const title = clip.title;
    if (!title) return null;
    const hash = titleHash(title, sequence);
    let entry = this.titles.get(clip.id);
    if (!entry || entry.hash !== hash) {
      await ensureFontLoaded(title.fontFamily, title.fontWeight, title.italic);
      if (this.destroyed) return null;
      entry = this.titles.get(clip.id);
      if (!entry || entry.hash !== hash) {
        if (entry) entry.view.destroy();
        entry = { hash, view: buildTitleText(title, sequence), used: now };
        this.titles.set(clip.id, entry);
      }
    }
    entry.used = now;
    const view = entry.view.view;
    return this.wrapLayer(clip, view, this.width, this.height, sequence, time, now, () => {
      view.parent?.removeChild(view);
    });
  }

  // the common part of every visual layer: crop, effect filters, the fixed
  // transform, opacity and blend mode. content is drawn in media px, the
  // returned node in sequence px
  private wrapLayer(
    clip: Clip,
    content: Container,
    mediaW: number,
    mediaH: number,
    sequence: Sequence,
    time: number,
    now: number,
    release: () => void
  ): Layer {
    const clipTime = time - clip.start;
    const inner = new Container();
    inner.addChild(content);

    let mask: Graphics | null = null;
    const crop = findEffect(clip, 'crop');
    if (crop && crop.enabled) {
      const r = cropRect(paramsAt(crop, clipTime), mediaW, mediaH);
      mask = new Graphics().rect(r.x, r.y, r.width, r.height).fill({ color: 0xffffff });
      inner.addChild(mask);
      inner.mask = mask;
    }

    const filters: Filter[] = [];
    for (const effect of clip.effects) {
      if (!effect.enabled || effect.fixed) continue;
      const runtime = this.effectRuntime(effect, now);
      if (!runtime) continue;
      runtime.update(paramsAt(effect, clipTime), { width: mediaW, height: mediaH, time: clipTime, fps: sequence.fps });
      filters.push(runtime.filter);
    }
    if (filters.length > 0) inner.filters = filters;

    const flip = findEffect(clip, 'flip');
    const transformParams = readTransform(paramsAt(findEffect(clip, 'transform') ?? emptyEffect, clipTime));
    if (flip && flip.enabled) {
      const p = paramsAt(flip, clipTime);
      if (p.horizontal === true || p.flipH === true) transformParams.flipH = !transformParams.flipH;
      if (p.vertical === true || p.flipV === true) transformParams.flipV = !transformParams.flipV;
    }
    const t = computeSpriteTransform(transformParams, mediaW, mediaH, this.width, this.height);
    const node = new Container();
    node.addChild(inner);
    node.pivot.set(t.pivot.x, t.pivot.y);
    node.position.set(t.x, t.y);
    node.scale.set(t.scaleX, t.scaleY);
    node.rotation = t.rotation;

    const opacity = findEffect(clip, 'opacity');
    if (opacity && opacity.enabled) {
      const p = paramsAt(opacity, clipTime);
      const value = typeof p.opacity === 'number' ? p.opacity : 100;
      node.alpha = Math.min(1, Math.max(0, value / 100));
      const mode = typeof p.blendMode === 'string' ? blendModes[p.blendMode] : undefined;
      node.blendMode = mode ?? 'normal';
    }

    return {
      node,
      cleanup: () => {
        inner.filters = [];
        inner.mask = null;
        inner.removeChild(content);
        release();
        node.destroy({ children: true });
      }
    };
  }

  private effectRuntime(effect: EffectInstance, now: number): VideoEffectRuntime | null {
    let entry = this.effects.get(effect.id);
    if (entry && entry.type !== effect.type) {
      entry.runtime.destroy();
      this.effects.delete(effect.id);
      entry = undefined;
    }
    if (!entry) {
      let runtime: VideoEffectRuntime | null = null;
      try {
        runtime = createVideoEffect(effect.type);
      } catch (e) {
        console.warn(`[braincut] effect ${effect.type} failed to build:`, e);
      }
      if (!runtime) return null;
      entry = { type: effect.type, runtime, used: now };
      this.effects.set(effect.id, entry);
    }
    entry.used = now;
    return entry.runtime;
  }

  private acquireTarget(): RenderTexture {
    const rt = this.rtPool.pop();
    if (rt) return rt;
    return RenderTexture.create({
      width: Math.max(1, Math.round(this.width * this.scale)),
      height: Math.max(1, Math.round(this.height * this.scale)),
      antialias: false,
      autoGarbageCollect: false
    });
  }

  // the missing side of a single sided transition, fully transparent so
  // whatever sits on the tracks below shows through
  private emptyTexture(): RenderTexture {
    if (!this.empty) {
      this.empty = this.acquireTarget();
      this.renderer?.render({ container: new Container(), target: this.empty, clear: true, clearColor: [0, 0, 0, 0] });
    }
    return this.empty;
  }

  private safeMarginsOverlay(): Graphics {
    if (!this.safeMargins) {
      const g = new Graphics();
      const w = this.width;
      const h = this.height;
      g.rect(w * 0.05, h * 0.05, w * 0.9, h * 0.9).stroke({ color: 0xffffff, alpha: 0.5, width: Math.max(1, w / 960) });
      g.rect(w * 0.1, h * 0.1, w * 0.8, h * 0.8).stroke({ color: 0xffffff, alpha: 0.35, width: Math.max(1, w / 960) });
      this.safeMargins = g;
    }
    return this.safeMargins;
  }

  private sweep(now: number): void {
    for (const [id, e] of this.effects) {
      if (now - e.used > CACHE_IDLE) {
        e.runtime.destroy();
        this.effects.delete(id);
      }
    }
    for (const [id, e] of this.titles) {
      if (now - e.used > CACHE_IDLE) {
        e.view.destroy();
        this.titles.delete(id);
      }
    }
    for (const [id, e] of this.transitions) {
      if (now - e.used > CACHE_IDLE) {
        e.filter.destroy();
        this.transitions.delete(id);
      }
    }
    for (const [id, e] of this.stills) {
      if (now - e.used > CACHE_IDLE) {
        e.texture.destroy(true);
        this.stills.delete(id);
      }
    }
  }

  private dropTargets(): void {
    for (const rt of this.rtPool) rt.destroy(true);
    this.rtPool = [];
    this.empty?.destroy(true);
    this.empty = null;
  }

  private dropGpuCaches(): void {
    this.dropTargets();
    for (const e of this.stills.values()) e.texture.destroy(true);
    this.stills.clear();
    for (const e of this.titles.values()) e.view.destroy();
    this.titles.clear();
    for (const e of this.effects.values()) e.runtime.destroy();
    this.effects.clear();
    for (const e of this.transitions.values()) e.filter.destroy();
    this.transitions.clear();
    this.safeMargins?.destroy();
    this.safeMargins = null;
  }

  // drops every cached picture of one media, e.g. after a relink
  forget(mediaId: Id): void {
    const still = this.stills.get(mediaId);
    if (still) {
      still.texture.destroy(true);
      this.stills.delete(mediaId);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    void this.tail.then(() => {
      this.dropGpuCaches();
      this.root.destroy({ children: true });
      this.renderer?.destroy();
      this.renderer = null;
    });
  }
}

const emptyEffect: EffectInstance = { id: '', type: 'transform', enabled: true, fixed: true, params: {}, keyframes: {} };
