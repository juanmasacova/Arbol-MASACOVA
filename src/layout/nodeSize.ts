/**
 * How big a person's card must be so that their whole name (and dates) always fit.
 *
 * Strategy, in order: keep the standard box; widen the box (up to MAX_W); wrap onto more lines;
 * shrink the font (down to MIN_FONT); and as a last resort break very long unbroken words so that
 * nothing is ever cut off. Pure apart from text measurement, which uses a canvas in the browser and a
 * character-width estimate elsewhere (tests).
 */

export const NODE_W = 150;
export const NODE_H = 92;

export const BASE_FONT = 18;
export const MIN_FONT = 9;
export const DATE_FONT = 13;
export const MIN_DATE_FONT = 8;
const MAX_W = 290;
const SIDE_PAD = 14;
const MAX_LINES = 5;
const FONT_STACK = `'Patrick Hand', 'Segoe Print', 'Comic Sans MS', 'Bradley Hand', cursive, sans-serif`;

export interface NodeSize {
  w: number;
  h: number;
  /** Name split into lines (usually one). */
  lines: string[];
  fontSize: number;
  lineHeight: number;
  dateFontSize: number;
}

export const DEFAULT_SIZE: NodeSize = {
  w: NODE_W,
  h: NODE_H,
  lines: [],
  fontSize: BASE_FONT,
  lineHeight: Math.round(BASE_FONT * 1.1),
  dateFontSize: DATE_FONT,
};

// ---- text measurement --------------------------------------------------------------------------------

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
const sizes = new Map<string, NodeSize>();

function canvasContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  context = null;
  try {
    const headless = typeof navigator === 'undefined' || /jsdom/i.test(navigator.userAgent);
    if (!headless && typeof document !== 'undefined') context = document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }
  return context;
}

/** Call after the web fonts have loaded so earlier (fallback-font) measurements are thrown away. */
export function resetTextMeasurements(): void {
  widths.clear();
  sizes.clear();
}

export function measureText(text: string, px: number): number {
  const key = `${px}|${text}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  let width: number;
  const ctx = canvasContext();
  if (ctx) {
    ctx.font = `${px}px ${FONT_STACK}`;
    width = ctx.measureText(text).width;
  } else {
    width = text.length * px * 0.52;
  }
  if (widths.size > 4000) widths.clear();
  widths.set(key, width);
  return width;
}

// ---- wrapping ----------------------------------------------------------------------------------------

/** Break one over-long word into pieces that each fit `max`. */
function breakWord(word: string, px: number, max: number): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const ch of Array.from(word)) {
    if (current && measureText(current + ch, px) > max) {
      pieces.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Greedy word wrap. Words wider than `max` are broken. */
function wrap(text: string, px: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const pieces = measureText(word, px) > max ? breakWord(word, px, max) : [word];
    for (const piece of pieces) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (!line || measureText(candidate, px) <= max) line = candidate;
      else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// ---- sizing ------------------------------------------------------------------------------------------

export function sizeNode(name: string, dates: string): NodeSize {
  const cacheKey = `${name}\u0000${dates}`;
  const cached = sizes.get(cacheKey);
  if (cached) return cached;
  const size = computeSize(name, dates);
  if (sizes.size > 2000) sizes.clear();
  sizes.set(cacheKey, size);
  return size;
}

function computeSize(name: string, dates: string): NodeSize {
  const label = name.trim() || 'Unnamed';
  const textMax = MAX_W - SIDE_PAD * 2;

  let fontSize = BASE_FONT;
  let lines: string[] = [label];

  const single = measureText(label, BASE_FONT);
  if (single > textMax) {
    // too long for one line even in the widest box: wrap, then shrink until it is tidy
    fontSize = BASE_FONT;
    lines = wrap(label, fontSize, textMax);
    while ((lines.length > 2 || lines.some((l) => measureText(l, fontSize) > textMax)) && fontSize > MIN_FONT) {
      fontSize -= 1;
      lines = wrap(label, fontSize, textMax);
    }
    if (lines.length > MAX_LINES) fontSize = MIN_FONT;
    if (fontSize === MIN_FONT) lines = wrap(label, MIN_FONT, textMax);
  }

  let dateFont = DATE_FONT;
  if (dates) {
    while (dateFont > MIN_DATE_FONT && measureText(dates, dateFont) > textMax) dateFont -= 1;
  }

  const widest = Math.max(...lines.map((l) => measureText(l, fontSize)), dates ? measureText(dates, dateFont) : 0);
  const w = Math.round(Math.min(MAX_W, Math.max(NODE_W, widest + SIDE_PAD * 2)));
  const lineHeight = Math.round(fontSize * 1.1);
  const h = NODE_H + (lines.length - 1) * lineHeight;
  return { w, h, lines, fontSize, lineHeight, dateFontSize: dateFont };
}
