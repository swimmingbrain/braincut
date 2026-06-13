import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import type { TitleData } from '$lib/project/types';

// the fonts the title editor offers. the first three are loaded by the page,
// the rest are what every system ships
export const fontFamilies = [
  'Inter',
  'JetBrains Mono',
  'Instrument Serif',
  'Georgia',
  'Times New Roman',
  'Arial',
  'Helvetica',
  'Verdana',
  'Courier New',
  'Impact',
  'system-ui'
] as const;

const loaded = new Set<string>();

// a title drawn before its web font arrived renders in the fallback and is
// cached that way, so the compositor waits for this before building one
export async function ensureFontLoaded(family: string, weight: number, italic: boolean): Promise<void> {
  const key = `${italic ? 'italic ' : ''}${weight} 16px "${family}"`;
  if (loaded.has(key)) return;
  if (typeof document === 'undefined' || !document.fonts?.load) {
    loaded.add(key);
    return;
  }
  try {
    await document.fonts.load(key);
  } catch {}
  loaded.add(key);
}

export function fontReady(family: string, weight: number, italic: boolean): boolean {
  return loaded.has(`${italic ? 'italic ' : ''}${weight} 16px "${family}"`);
}

// anything that changes the rendered picture goes into the hash, the
// compositor rebuilds the title when it moves
export function titleHash(title: TitleData, seq: { width: number; height: number }): string {
  return JSON.stringify([title, seq.width, seq.height]);
}

export function titleStyle(title: TitleData, seq: { width: number; height: number }): TextStyleOptions {
  const style: TextStyleOptions = {
    fontFamily: [title.fontFamily, 'sans-serif'],
    fontSize: title.fontSize,
    fontWeight: String(title.fontWeight) as TextStyleOptions['fontWeight'],
    fontStyle: title.italic ? 'italic' : 'normal',
    fill: title.color,
    align: title.align,
    lineHeight: title.fontSize * title.lineHeight,
    letterSpacing: title.letterSpacing,
    wordWrap: true,
    wordWrapWidth: Math.max(1, title.box.width * seq.width),
    breakWords: false,
    whiteSpace: 'pre-line'
  };
  if (title.stroke && title.stroke.width > 0) {
    style.stroke = { color: title.stroke.color, width: title.stroke.width, join: 'round' };
  }
  if (title.shadow) {
    const distance = Math.hypot(title.shadow.x, title.shadow.y);
    style.dropShadow = {
      color: title.shadow.color,
      blur: title.shadow.blur,
      distance,
      angle: Math.atan2(title.shadow.y, title.shadow.x),
      alpha: 1
    };
  }
  return style;
}

export interface TitleView {
  view: Container;
  text: Text;
  destroy(): void;
}

// builds the frame sized picture of a title: the text block is centered in
// its box, the optional background hugs the block. the compositor treats the
// result like a piece of media the size of the sequence
export function buildTitleText(title: TitleData, seq: { width: number; height: number }): TitleView {
  const view = new Container();
  const text = new Text({
    text: title.text,
    style: titleStyle(title, seq),
    // titles are rendered once per change, the extra sharpness is cheap
    resolution: 2,
    anchor: 0.5
  });
  const cx = (title.box.x + title.box.width / 2) * seq.width;
  const cy = title.box.y * seq.height;
  text.position.set(cx, cy);

  let background: Graphics | null = null;
  if (title.background) {
    const pad = title.background.padding;
    const w = text.width + pad * 2;
    const h = text.height + pad * 2;
    background = new Graphics().rect(cx - w / 2, cy - h / 2, w, h).fill({ color: title.background.color });
    view.addChild(background);
  }
  view.addChild(text);

  return {
    view,
    text,
    destroy: () => {
      view.destroy({ children: true, texture: true, textureSource: true });
    }
  };
}
