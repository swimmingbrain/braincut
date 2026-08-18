import 'pixi.js/advanced-blend-modes';
import {
  autoDetectRenderer,
  Container,
  Graphics,
  ImageSource,
  RenderTexture,
  Sprite,
  Text,
  Texture,
  type BLEND_MODES,
  type Filter,
  type Renderer
} from 'pixi.js';
import type { Clip, EffectInstance, Id, MediaItem, Rotation, Sequence, Track, Transition } from '$lib/project/types';
import { paramsAt } from '$lib/project/keyframes';
import { clipAt } from '$lib/project/ops';
import { createVideoEffect } from '$lib/engine/effects/filters';
import { ToneMapFilter, toneMapMode } from '$lib/engine/effects/shaders/tone-map';
import { transitionDef } from '$lib/engine/transitions/registry';
import { createTransitionFilter } from '$lib/engine/transitions/filter';
import type { FrameHandle } from './media-reader';
import type { FrameMode, FrameProvider } from './media-cache';
import { buildTitleText, ensureFontLoaded, titleHash, type TitleView } from './text';
import { computeSpriteTransform, cropRect, readTransform } from './transform';
import { sourceTimeAt } from './clip-time';
import { phase, phaseAsync } from './profile';

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
// the slate a clip that cannot be decoded here gets in place of its picture
const BROKEN_BG = 0x1c2026;
const BROKEN_EDGE = 0x2e3540;

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

// normal, add, multiply and screen are what gl blends by itself. the rest go
// through a filter that reads the picture underneath, and only those need the
// renderer to draw the frame into a back buffer first
const advancedBlend = new Set<BLEND_MODES>([
  'overlay',
  'darken',
  'lighten',
  'difference',
  'exclusion',
  'hard-light',
  'soft-light',
  'color-dodge',
  'color-burn'
]);

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
  // the canvas is kept at even pixel sizes, so at a quarter or an eighth the
  // two axes can drift a hair from the asked-for factor. the scene is scaled
  // by the real ratio instead
  private scaleX = 1;
  private scaleY = 1;

  private renderer: Renderer | null = null;
  private readonly root = new Container();
  private lost = false;
  private destroyed = false;
  private tail: Promise<unknown> = Promise.resolve();

  private readonly effects = new Map<Id, { type: string; runtime: VideoEffectRuntime; used: number }>();
  private readonly titles = new Map<Id, { hash: string; view: TitleView; used: number }>();
  private readonly transitions = new Map<Id, { type: string; filter: TransitionFilter; used: number }>();
  private readonly stills = new Map<Id, { bitmap: ImageBitmap; texture: Texture; used: number }>();
  private readonly slates = new Map<Id, { key: string; view: Container; used: number }>();
  private readonly toneMaps = new Map<string, ToneMapFilter>();
  private readonly onRecovered?: () => void;
  // taken while the context is alive: getExtension returns null once it is
  // gone, and this is the only way to ask for it back
  private loseContext: WEBGL_lose_context | null = null;
  private backBuffer: { useBackBuffer: boolean } | null = null;
  private needsBackdrop = false;
  private rtPool: RenderTexture[] = [];
  private empty: RenderTexture | null = null;
  // the stage one side of a transition is drawn through, kept between frames
  private readonly side = new Container();
  private safeMargins: Graphics | null = null;

  private readonly onLost = (e: Event) => {
    e.preventDefault();
    if (this.lost) return;
    this.lost = true;
    try {
      this.dropGpuCaches();
    } catch {}
    // nothing comes back on its own, the context has to be asked for
    setTimeout(() => this.requestRestore(), 0);
  };
  private readonly onRestored = () => {
    this.lost = false;
    try {
      this.dropGpuCaches();
    } catch {}
    this.onRecovered?.();
  };

  private requestRestore(): void {
    if (this.destroyed || !this.lost) return;
    try {
      this.loseContext?.restoreContext();
    } catch {}
  }

  // true while the gl context is gone, the monitor offers a reset then
  get contextLost(): boolean {
    return this.lost;
  }

  constructor(opts: { width: number; height: number; scale?: number; background?: number; onRecovered?: () => void }) {
    this.onRecovered = opts.onRecovered;
    this.width = Math.max(1, Math.round(opts.width));
    this.height = Math.max(1, Math.round(opts.height));
    this.scale = opts.scale ?? 1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = even(this.width * this.scale);
    this.canvas.height = even(this.height * this.scale);
    this.canvas.addEventListener('webglcontextlost', this.onLost);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.applyScale();
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
      gcActive: false
    });
    if (this.destroyed) {
      renderer.destroy();
      return;
    }
    this.renderer = renderer;
    const gl = (renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
    this.loseContext = gl?.getExtension('WEBGL_lose_context') ?? null;
    this.backBuffer = (renderer as unknown as { backBuffer?: { useBackBuffer: boolean } }).backBuffer ?? null;
  }

  setSize(width: number, height: number, scale: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const s = Math.max(0.05, scale);
    if (w === this.width && h === this.height && s === this.scale) return;
    this.width = w;
    this.height = h;
    this.scale = s;
    const cw = even(w * s);
    const ch = even(h * s);
    if (this.renderer) this.renderer.resize(cw, ch);
    else {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.applyScale();
    this.dropTargets();
    for (const t of this.titles.values()) t.view.destroy();
    this.titles.clear();
    this.safeMargins?.destroy();
    this.safeMargins = null;
  }

  private applyScale(): void {
    this.scaleX = this.canvas.width / this.width;
    this.scaleY = this.canvas.height / this.height;
    this.root.scale.set(this.scaleX, this.scaleY);
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
      // a sequence of another size keeps the canvas at its pixel size and
      // is scaled into it, which is what an export at a smaller size wants.
      // the player resizes explicitly before rendering, so it never gets here
      this.setSize(sequence.width, sequence.height, this.canvas.width / sequence.width);
    }

    const cleanups: Array<() => void> = [];
    const usedTargets: RenderTexture[] = [];
    const now = performance.now();
    this.needsBackdrop = false;
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
        const layer = await this.safeClipLayer(clip, sequence, time, ctx, now);
        if (layer) {
          this.root.addChild(layer.node);
          cleanups.push(layer.cleanup);
        }
      }

      if (ctx.showSafeMargins && ctx.mode !== 'export') {
        this.root.addChild(this.safeMarginsOverlay());
      }
      if (this.lost || this.destroyed) return;
      // the back buffer costs a full frame copy every render and only the
      // blend modes that read what is underneath need it
      if (this.backBuffer) this.backBuffer.useBackBuffer = this.needsBackdrop;
      phase('draw', () => renderer.render({ container: this.root }));
    } finally {
      phase('cleanup', () => {
        this.root.removeChildren();
        for (const c of cleanups) {
          try {
            c();
          } catch {}
        }
        for (const rt of usedTargets) this.rtPool.push(rt);
        this.sweep(now);
      });
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
      outgoing && outgoing.enabled ? this.safeClipLayer(outgoing, sequence, time, ctx, now) : Promise.resolve(null),
      incoming && incoming.enabled ? this.safeClipLayer(incoming, sequence, time, ctx, now) : Promise.resolve(null)
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
      const stage = this.side;
      stage.scale.set(this.scaleX, this.scaleY);
      stage.addChild(layer.node);
      renderer.render({ container: stage, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
      stage.removeChildren();
      layer.cleanup();
      return rt;
    };
    const [fromTex, toTex] = phase('transition', () => [toTexture(from), toTexture(to)]);

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

  // whatever a single clip does wrong, the rest of the frame still draws
  private async safeClipLayer(clip: Clip, sequence: Sequence, time: number, ctx: RenderContext, now: number): Promise<Layer | null> {
    try {
      return await phaseAsync('layer', () => this.buildClipLayer(clip, sequence, time, ctx, now));
    } catch (e) {
      const media = clip.mediaId ? ctx.media(clip.mediaId) : undefined;
      if (media) ctx.frames.reportUnusable?.(media.id, media.name, e instanceof Error ? e.message : String(e));
      else console.warn(`[braincut] clip ${clip.name} could not be drawn:`, e);
      try {
        return this.buildSlateLayer(clip, sequence, time, now, 'this clip cannot be drawn here');
      } catch {
        return null;
      }
    }
  }

  // a dark slate with the clip's name where its picture would be, so a file
  // this browser cannot decode leaves a hole nobody can explain
  private buildSlateLayer(clip: Clip, sequence: Sequence, time: number, now: number, line: string): Layer {
    const w = this.width;
    const h = this.height;
    const key = `${clip.name}|${line}|${w}x${h}`;
    let entry = this.slates.get(clip.id);
    if (!entry || entry.key !== key) {
      entry?.view.destroy({ children: true, texture: true, textureSource: true });
      const view = new Container();
      view.addChild(new Graphics().rect(0, 0, w, h).fill({ color: BROKEN_BG }));
      const inset = Math.round(Math.min(w, h) * 0.06);
      view.addChild(
        new Graphics()
          .rect(inset, inset, w - inset * 2, h - inset * 2)
          .stroke({ color: BROKEN_EDGE, width: Math.max(1, Math.round(h / 360)) })
      );
      const size = Math.max(12, Math.round(h / 22));
      const name = new Text({
        text: clip.name,
        style: { fontFamily: ['Inter', 'sans-serif'], fontSize: size, fill: '#d4d4d8', align: 'center', wordWrap: true, wordWrapWidth: w * 0.8 },
        anchor: 0.5,
        resolution: 2
      });
      name.position.set(w / 2, h / 2 - size * 0.7);
      const note = new Text({
        text: line,
        style: { fontFamily: ['Inter', 'sans-serif'], fontSize: Math.round(size * 0.7), fill: '#a1a1aa', align: 'center', wordWrap: true, wordWrapWidth: w * 0.8 },
        anchor: 0.5,
        resolution: 2
      });
      note.position.set(w / 2, h / 2 + size * 0.7);
      view.addChild(name);
      view.addChild(note);
      entry = { key, view, used: now };
      this.slates.set(clip.id, entry);
    }
    entry.used = now;
    const view = entry.view;
    return this.wrapLayer(clip, view, w, h, sequence, time, now, () => {
      view.parent?.removeChild(view);
    });
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
    if (ctx.frames.failure?.(media.id)) {
      return this.buildSlateLayer(clip, sequence, time, now, "this file can't be decoded here");
    }
    const sourceTime = sourceTimeAt(clip, time, media.duration);
    const handle = await phaseAsync('decode', () => ctx.frames.getFrame(media, sourceTime, ctx.mode, clip.id));
    if (!handle) {
      // the cache turns a decode that threw into a remembered failure, a
      // plain miss (a clip that starts before its media) still draws nothing
      if (ctx.frames.failure?.(media.id)) {
        return this.buildSlateLayer(clip, sequence, time, now, "this file can't be decoded here");
      }
      return null;
    }
    if (this.lost || this.destroyed) {
      handle.release();
      return null;
    }

    const mediaW = media.width > 0 ? media.width : handle.width;
    const mediaH = media.height > 0 ? media.height : handle.height;
    const rotation = handle.rotation ?? media.rotation;
    let texture: Texture;
    try {
      texture = phase('upload', () => this.textureFor(media, handle, now));
    } catch (e) {
      handle.release();
      ctx.frames.reportUnusable?.(media.id, media.name, e instanceof Error ? e.message : String(e));
      return this.buildSlateLayer(clip, sequence, time, now, "this file can't be decoded here");
    }
    const sprite = new Sprite(texture);
    // a proxy or a converted copy may be smaller than the original, the
    // sprite is stretched to the size the project knows
    const swap = rotation === 90 || rotation === 270;
    sprite.setSize(swap ? mediaH : mediaW, swap ? mediaW : mediaH);
    this.placeRotated(sprite, rotation, mediaW, mediaH);
    const tone = toneMapMode(handle.transfer);
    if (tone) sprite.filters = [this.toneMap(tone)];

    return this.wrapLayer(clip, sprite, mediaW, mediaH, sequence, time, now, () => {
      sprite.filters = [];
      sprite.destroy();
      if (!(handle.image instanceof ImageBitmap)) texture.destroy(true);
      handle.release();
    });
  }

  // one instance per transfer curve, shared by every hdr clip in the frame
  private toneMap(mode: 'pq' | 'hlg'): Filter {
    let filter = this.toneMaps.get(mode);
    if (!filter) {
      filter = new ToneMapFilter(mode);
      this.toneMaps.set(mode, filter);
    }
    return filter as Filter;
  }

  // the texture a picture is drawn from. a still is cached with its bitmap,
  // a decoded video frame gets a texture of its own for the one draw
  private textureFor(media: MediaItem, handle: FrameHandle, now: number): Texture {
    const image = handle.image;
    if (image instanceof ImageBitmap) {
      const cached = this.stills.get(media.id);
      if (cached && cached.bitmap === image) {
        cached.used = now;
        return cached.texture;
      }
      if (cached) cached.texture.destroy(true);
      const texture = new Texture({
        source: new ImageSource({ resource: image, width: image.width, height: image.height, autoGarbageCollect: false })
      });
      this.stills.set(media.id, { bitmap: image, texture, used: now });
      return texture;
    }
    // gl is measurably happier making a texture for every decoded picture
    // than writing into one it may still be reading from, so this one is
    // handed over and destroyed as soon as the frame it was drawn in is done
    return new Texture({
      source: new ImageSource({ resource: image, width: handle.width, height: handle.height, autoGarbageCollect: false })
    });
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
        entry = { hash, view: phase('text', () => buildTitleText(title, sequence)), used: now };
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

    const flip = findEffect(clip, 'flip');
    const transformParams = readTransform(paramsAt(findEffect(clip, 'transform') ?? emptyEffect, clipTime));
    if (flip && flip.enabled) {
      const p = paramsAt(flip, clipTime);
      if (p.horizontal === true || p.flipH === true) transformParams.flipH = !transformParams.flipH;
      if (p.vertical === true || p.flipV === true) transformParams.flipV = !transformParams.flipV;
    }
    const t = computeSpriteTransform(transformParams, mediaW, mediaH, this.width, this.height);
    // pixi renders a filter at the size the layer covers on screen, so an
    // effect measured in pixels is told how big a media pixel currently is
    const pixelScale = Math.abs(t.scaleX) * this.scaleX;

    phase('effects', () => {
      const filters: Filter[] = [];
      for (const effect of clip.effects) {
        if (!effect.enabled || effect.fixed) continue;
        const runtime = this.effectRuntime(effect, now);
        if (!runtime) continue;
        runtime.update(paramsAt(effect, clipTime), {
          width: mediaW,
          height: mediaH,
          time: clipTime,
          fps: sequence.fps,
          scale: pixelScale > 0 ? pixelScale : 1
        });
        filters.push(runtime.filter);
      }
      if (filters.length > 0) inner.filters = filters;
    });

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
      if (mode && advancedBlend.has(mode)) this.needsBackdrop = true;
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
      width: this.canvas.width,
      height: this.canvas.height,
      antialias: false,
      autoGarbageCollect: false
    });
  }

  // the missing side of a single sided transition, fully transparent so
  // whatever sits on the tracks below shows through
  private emptyTexture(): RenderTexture {
    if (!this.empty) {
      this.empty = this.acquireTarget();
      const nothing = new Container();
      this.renderer?.render({ container: nothing, target: this.empty, clear: true, clearColor: [0, 0, 0, 0] });
      nothing.destroy();
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
    for (const [id, e] of this.slates) {
      if (now - e.used > CACHE_IDLE) {
        e.view.destroy({ children: true, texture: true, textureSource: true });
        this.slates.delete(id);
      }
    }
  }

  private dropTargets(): void {
    // a transition still points at the textures it last mixed
    for (const e of this.transitions.values()) e.filter.clearInputs();
    for (const rt of this.rtPool) rt.destroy(true);
    this.rtPool = [];
    this.empty?.destroy(true);
    this.empty = null;
  }

  private dropGpuCaches(): void {
    this.dropTargets();
    for (const e of this.slates.values()) e.view.destroy({ children: true, texture: true, textureSource: true });
    this.slates.clear();
    for (const f of this.toneMaps.values()) f.destroy();
    this.toneMaps.clear();
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
    // a relinked or converted file gets its slate cleared with it
    for (const [id, e] of this.slates) {
      e.view.destroy({ children: true, texture: true, textureSource: true });
      this.slates.delete(id);
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
      this.side.destroy();
      this.renderer?.destroy();
      this.renderer = null;
    });
  }
}

// gl is happier with even render target sizes, and an odd one costs a half
// pixel of sampling in every filter that walks its neighbours
function even(v: number): number {
  return Math.max(2, Math.round(v / 2) * 2);
}

const emptyEffect: EffectInstance = { id: '', type: 'transform', enabled: true, fixed: true, params: {}, keyframes: {} };
