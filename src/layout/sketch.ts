/** Deterministic hand-drawn look: turns clean SVG path data into slightly wobbly path data. */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * Accepts absolute M, L, H, V, Q and Z commands (everything the layout emits) and returns a polyline-ish path
 * whose points are nudged by up to `amp` pixels. Same input + seed always gives the same drawing.
 */
export function sketchify(d: string, seed: number, amp = 1.4, step = 22): string {
  const rnd = mulberry32(seed);
  const jitter = (scale = 1) => (rnd() - 0.5) * 2 * amp * scale;
  const tokens = d.match(/[MLHVQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: string[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  const next = () => Number(tokens[i++]);

  const lineTo = (x: number, y: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x - cx, y - cy) / step));
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const edge = s === n ? 0.35 : 1;
      out.push(`L${fmt(cx + (x - cx) * t + jitter(edge))} ${fmt(cy + (y - cy) * t + jitter(edge))}`);
    }
    cx = x;
    cy = y;
  };

  while (i < tokens.length) {
    const cmd = tokens[i++]!.toUpperCase();
    if (cmd === 'M') {
      cx = next();
      cy = next();
      startX = cx;
      startY = cy;
      out.push(`M${fmt(cx + jitter(0.4))} ${fmt(cy + jitter(0.4))}`);
    } else if (cmd === 'L') {
      lineTo(next(), next());
    } else if (cmd === 'H') {
      lineTo(next(), cy);
    } else if (cmd === 'V') {
      lineTo(cx, next());
    } else if (cmd === 'Q') {
      const qx = next();
      const qy = next();
      const x = next();
      const y = next();
      const n = Math.max(4, Math.round((Math.hypot(qx - cx, qy - cy) + Math.hypot(x - qx, y - qy)) / step));
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        const u = 1 - t;
        const edge = s === n ? 0.35 : 1;
        out.push(`L${fmt(u * u * cx + 2 * u * t * qx + t * t * x + jitter(edge))} ${fmt(u * u * cy + 2 * u * t * qy + t * t * y + jitter(edge))}`);
      }
      cx = x;
      cy = y;
    } else if (cmd === 'Z') {
      lineTo(startX, startY);
      out.push('Z');
    }
  }
  return out.join(' ');
}

/** Clean rounded rectangle centred on the origin, as absolute path data. */
export function roundedRectPath(w: number, h: number, r: number): string {
  const x = -w / 2;
  const y = -h / 2;
  return [
    `M ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `L ${x + r} ${y + h}`,
    `Q ${x} ${y + h} ${x} ${y + h - r}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

/** A slightly lumpy circle, as a closed path. */
export function circlePath(cx: number, cy: number, r: number, seed: number): string {
  const rnd = mulberry32(seed);
  const points = 18;
  const parts: string[] = [];
  for (let p = 0; p < points; p++) {
    const angle = (p / points) * Math.PI * 2;
    const radius = r + (rnd() - 0.5) * 1.6;
    parts.push(`${p === 0 ? 'M' : 'L'}${fmt(cx + Math.cos(angle) * radius)} ${fmt(cy + Math.sin(angle) * radius)}`);
  }
  parts.push('Z');
  return parts.join(' ');
}
