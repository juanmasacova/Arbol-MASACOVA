import { describe, expect, it } from 'vitest';
import { circlePath, hashString, roundedRectPath, sketchify } from './sketch';

describe('sketchify', () => {
  const d = 'M 0 0 L 100 0 V 80 Q 150 120 200 80 H 40 Z';

  it('is deterministic for the same seed and differs for another', () => {
    expect(sketchify(d, 7)).toBe(sketchify(d, 7));
    expect(sketchify(d, 7)).not.toBe(sketchify(d, 8));
  });

  it('never emits NaN or undefined, even for zero-length and horizontal-only paths', () => {
    for (const path of [d, 'M 5 5 L 5 5', 'M 0 10 L 300 10', roundedRectPath(150, 92, 16), 'M 1 1 Q 1 1 1 1']) {
      expect(sketchify(path, 3)).not.toMatch(/NaN|undefined|Infinity/);
    }
  });

  it('stays close to the original geometry', () => {
    const out = sketchify('M 0 0 L 200 0', 5, 1.4);
    const ys = [...out.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
    expect(Math.max(...ys.map(Math.abs))).toBeLessThanOrEqual(1.5);
  });
});

describe('helpers', () => {
  it('hashes strings stably', () => {
    expect(hashString('p_abc')).toBe(hashString('p_abc'));
    expect(hashString('p_abc')).not.toBe(hashString('p_abd'));
  });
  it('builds a closed circle path', () => {
    expect(circlePath(0, 0, 20, 1)).toMatch(/^M.*Z$/);
  });
});
