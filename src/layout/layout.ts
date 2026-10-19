import type { Graph, ID } from '../model/types';

export const NODE_W = 150;
export const NODE_H = 92;
export const ROW_H = 200;

const GAP_PARTNER = 28;
const GAP_SIBLING = 36;
const GAP_OTHER = 84;

export interface PlacedNode {
  id: ID;
  x: number; // centre
  y: number; // centre
  gen: number; // 0 = the root person; negative = older generations
}

export interface Connector {
  id: string;
  kind: 'parent' | 'partner' | 'other';
  d: string;
  label?: string;
  labelX?: number;
  labelY?: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TreeLayout {
  rootId: ID;
  ids: ID[];
  nodes: Record<ID, PlacedNode>;
  connectors: Connector[];
  bounds: Bounds;
}

/** Connected components over all edge types: every unconnected cluster is its own tree. */
export function findComponents(g: Graph): ID[][] {
  const ids = Object.keys(g.people);
  const parent = new Map<ID, ID>(ids.map((id) => [id, id]));
  const find = (id: ID): ID => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  for (const e of g.edges) {
    if (!parent.has(e.from) || !parent.has(e.to)) continue;
    parent.set(find(e.from), find(e.to));
  }
  const groups = new Map<ID, ID[]>();
  for (const id of ids) {
    const root = find(id);
    const group = groups.get(root);
    if (group) group.push(id);
    else groups.set(root, [id]);
  }
  return [...groups.values()];
}

/**
 * Isotonic projection: the positions closest to `desired` (least squares) that keep each item at least
 * `gaps[i]` to the right of the previous one. Pool-adjacent-violators on gap-shifted values.
 */
export function projectOrdered(desired: number[], gaps: number[]): number[] {
  const n = desired.length;
  const offset = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) offset[i] = offset[i - 1]! + gaps[i - 1]!;
  const shifted = desired.map((d, i) => d - offset[i]!);

  const blocks: { sum: number; count: number }[] = [];
  for (const value of shifted) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1]!;
      const prev = blocks[blocks.length - 2]!;
      if (prev.sum / prev.count <= last.sum / last.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: prev.sum + last.sum, count: prev.count + last.count });
    }
  }
  const result: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) result.push(b.sum / b.count + offset[result.length]!);
  return result;
}

export function layoutTree(g: Graph, ids: ID[], rootId: ID): TreeLayout {
  const inTree = new Set(ids);
  const edges = g.edges.filter((e) => inTree.has(e.from) && inTree.has(e.to));

  const parents = new Map<ID, ID[]>();
  const children = new Map<ID, ID[]>();
  const mates = new Map<ID, ID[]>(); // partners and "other" links: placed side by side
  const push = (map: Map<ID, ID[]>, key: ID, value: ID) => {
    const list = map.get(key);
    if (list) {
      if (!list.includes(value)) list.push(value);
    } else map.set(key, [value]);
  };
  const walk = new Map<ID, { to: ID; d: number }[]>();
  const addWalk = (from: ID, to: ID, d: number) => {
    const list = walk.get(from);
    if (list) list.push({ to, d });
    else walk.set(from, [{ to, d }]);
  };
  for (const e of edges) {
    if (e.type === 'parent') {
      push(children, e.from, e.to);
      push(parents, e.to, e.from);
      addWalk(e.from, e.to, 1);
      addWalk(e.to, e.from, -1);
    } else {
      push(mates, e.from, e.to);
      push(mates, e.to, e.from);
      addWalk(e.from, e.to, 0);
      addWalk(e.to, e.from, 0);
    }
  }

  // 1. generations: breadth-first from the root; conflicting edges are ignored rather than fatal
  const gen = new Map<ID, number>([[rootId, 0]]);
  const queue: ID[] = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const { to, d } of walk.get(id) ?? []) {
      if (!gen.has(to)) {
        gen.set(to, gen.get(id)! + d);
        queue.push(to);
      }
    }
  }
  for (const id of ids) if (!gen.has(id)) gen.set(id, 0);

  // 2. order within each generation: depth-first so partners and siblings stay together
  const seen = new Set<ID>();
  const sequence: ID[] = [];
  const place = (id: ID) => {
    if (seen.has(id)) return;
    seen.add(id);
    sequence.push(id);
    for (const mate of mates.get(id) ?? []) place(mate);
    for (const child of children.get(id) ?? []) place(child);
    for (const mate of mates.get(id) ?? []) for (const child of children.get(mate) ?? []) place(child);
  };
  const roots = ids
    .filter((id) => !(parents.get(id)?.length))
    .sort((a, b) => gen.get(a)! - gen.get(b)!);
  for (const id of roots) place(id);
  for (const id of ids) place(id);

  const rows = new Map<number, ID[]>();
  for (const id of sequence) {
    const g0 = gen.get(id)!;
    const row = rows.get(g0);
    if (row) row.push(id);
    else rows.set(g0, [id]);
  }
  const gens = [...rows.keys()].sort((a, b) => a - b);
  const minGen = gens[0]!;
  const maxGen = gens[gens.length - 1]!;

  const gapBetween = (a: ID, b: ID): number => {
    if (mates.get(a)?.includes(b)) return NODE_W + GAP_PARTNER;
    const pa = parents.get(a) ?? [];
    if (pa.some((p) => parents.get(b)?.includes(p))) return NODE_W + GAP_SIBLING;
    return NODE_W + GAP_OTHER;
  };
  const gapsFor = (row: ID[]) => row.slice(1).map((id, i) => gapBetween(row[i]!, id));

  // 3. horizontal positions: alternate "children follow parents" and "parents centre over children"
  const x = new Map<ID, number>();
  for (const row of rows.values()) {
    let cursor = 0;
    row.forEach((id, i) => {
      if (i > 0) cursor += gapBetween(row[i - 1]!, id);
      x.set(id, cursor);
    });
  }
  const mean = (list: ID[]): number | null =>
    list.length ? list.reduce((s, id) => s + x.get(id)!, 0) / list.length : null;
  const settle = (gen0: number, source: (id: ID) => ID[]) => {
    const row = rows.get(gen0);
    if (!row) return;
    const desired = row.map((id) => mean(source(id)) ?? x.get(id)!);
    const placed = projectOrdered(desired, gapsFor(row));
    row.forEach((id, i) => x.set(id, placed[i]!));
  };
  for (let iteration = 0; iteration < 12; iteration++) {
    for (let g1 = minGen + 1; g1 <= maxGen; g1++) settle(g1, (id) => parents.get(id) ?? []);
    for (let g1 = maxGen - 1; g1 >= minGen; g1--) settle(g1, (id) => children.get(id) ?? []);
  }

  const shift = x.get(rootId) ?? 0;
  const nodes: Record<ID, PlacedNode> = {};
  for (const id of ids) {
    const g1 = gen.get(id)!;
    nodes[id] = { id, x: x.get(id)! - shift, y: g1 * ROW_H, gen: g1 };
  }

  // 4. connectors
  const connectors: Connector[] = [];
  const rowIndex = (id: ID) => rows.get(gen.get(id)!)!.indexOf(id);
  const adjacent = (a: ID, b: ID) => gen.get(a) === gen.get(b) && Math.abs(rowIndex(a) - rowIndex(b)) === 1;

  for (const e of edges) {
    if (e.type === 'parent') continue;
    const a = nodes[e.from]!;
    const b = nodes[e.to]!;
    const [left, right] = a.x <= b.x ? [a, b] : [b, a];
    if (e.type === 'partner') {
      if (adjacent(a.id, b.id)) {
        connectors.push({
          id: e.id,
          kind: 'partner',
          d: `M ${left.x + NODE_W / 2} ${left.y} L ${right.x - NODE_W / 2} ${right.y}`,
          labelX: (left.x + right.x) / 2,
          labelY: (left.y + right.y) / 2,
        });
      } else {
        const y = Math.max(a.y, b.y) + NODE_H / 2;
        connectors.push({
          id: e.id,
          kind: 'partner',
          d: `M ${a.x} ${a.y + NODE_H / 2} Q ${(a.x + b.x) / 2} ${y + 46} ${b.x} ${b.y + NODE_H / 2}`,
        });
      }
    } else {
      const top = Math.min(a.y, b.y) - NODE_H / 2;
      const mx = (a.x + b.x) / 2;
      connectors.push({
        id: e.id,
        kind: 'other',
        d: `M ${a.x} ${a.y - NODE_H / 2} Q ${mx} ${top - 56} ${b.x} ${b.y - NODE_H / 2}`,
        label: e.label,
        labelX: mx,
        labelY: top - 30,
      });
    }
  }

  const groups = new Map<string, { parents: ID[]; kids: ID[] }>();
  for (const [child, ps] of parents) {
    const key = [...ps].sort().join('|');
    const group = groups.get(key);
    if (group) group.kids.push(child);
    else groups.set(key, { parents: [...ps].sort(), kids: [child] });
  }
  let groupIndex = 0;
  for (const [key, group] of groups) {
    const ps = group.parents.map((id) => nodes[id]!);
    const kids = group.kids.map((id) => nodes[id]!);
    const parentY = Math.max(...ps.map((p) => p.y));
    const busY = parentY + ROW_H / 2 + (groupIndex++ % 3) * 7 - 7;
    const starts: { x: number; y: number }[] = [];
    const [pa, pb] = group.parents;
    const partnered = group.parents.length === 2 && edges.some(
      (e) => e.type === 'partner' && ((e.from === pa && e.to === pb) || (e.from === pb && e.to === pa)),
    );
    if (partnered) {
      const direct = adjacent(pa!, pb!);
      starts.push({ x: (ps[0]!.x + ps[1]!.x) / 2, y: direct ? ps[0]!.y : parentY + NODE_H / 2 });
    } else {
      for (const p of ps) starts.push({ x: p.x, y: p.y + NODE_H / 2 });
    }
    const xs = [...starts.map((s) => s.x), ...kids.map((k) => k.x)];
    const parts: string[] = [];
    for (const s of starts) parts.push(`M ${s.x} ${s.y} V ${busY}`);
    parts.push(`M ${Math.min(...xs)} ${busY} H ${Math.max(...xs)}`);
    for (const k of kids) parts.push(`M ${k.x} ${busY} V ${k.y - NODE_H / 2}`);
    connectors.push({ id: `fam_${key}`, kind: 'parent', d: parts.join(' ') });
  }

  const all = Object.values(nodes);
  const bounds: Bounds = {
    minX: Math.min(...all.map((n) => n.x)) - NODE_W / 2,
    maxX: Math.max(...all.map((n) => n.x)) + NODE_W / 2,
    minY: Math.min(...all.map((n) => n.y)) - NODE_H / 2,
    maxY: Math.max(...all.map((n) => n.y)) + NODE_H / 2,
  };
  return { rootId, ids, nodes, connectors, bounds };
}

/**
 * One layout per separate tree. The tree containing `meId` comes first and is rooted at that person,
 * so the view is built around you; other trees are rooted at their first person.
 */
export function layoutAll(g: Graph, meId: ID | null): TreeLayout[] {
  const comps = findComponents(g);
  const layouts = comps.map((ids) => layoutTree(g, ids, meId && ids.includes(meId) ? meId : ids[0]!));
  layouts.sort((a, b) => Number(b.ids.includes(meId ?? '')) - Number(a.ids.includes(meId ?? '')));
  return layouts;
}

/** How many separate trees would exist if `id` were removed (used to warn before deleting). */
export function componentsWithout(g: Graph, id: ID): number {
  const people = { ...g.people };
  delete people[id];
  return findComponents({ people, edges: g.edges.filter((e) => e.from !== id && e.to !== id) }).length;
}
