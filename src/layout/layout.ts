import type { Graph, ID } from '../model/types';
import { NODE_H, NODE_W } from './nodeSize';

export { NODE_H, NODE_W };

/** Standard distance between generation rows (for default-size cards). */
export const ROW_H = 200;
/** Empty vertical space between one row's cards and the next row's cards: room for the connector lines. */
const ROW_GAP = ROW_H - NODE_H;

const GAP_PARTNER = 28;
const GAP_OTHER = 72;
const GAP_SIBLING = 36;
const GAP_COUSIN = 64;
const BUS_START = 26;
const BUS_STEP = 9;
const BUS_LEVELS = 6;

export interface SizeMap {
  [id: string]: { w: number; h: number } | undefined;
}

export interface PlacedNode {
  id: ID;
  x: number; // centre
  y: number; // centre
  gen: number; // 0 = the root person; negative = older generations
  w: number;
  h: number;
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

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

type LinkKind = 'partner' | 'other';

/** A couple (or a person with their partners / labelled connections): placed as one rigid block. */
interface Unit {
  members: ID[];
  off: Map<ID, number>; // member centre relative to the unit centre
  w: number;
  gen: number;
  x: number; // unit centre
  first: number; // creation order of the earliest member, for stable tie-breaks
}

/**
 * Family-tree layout.
 *
 * - Every generation is one horizontal row; ancestors above, descendants below.
 * - Partners (and anyone sharing a child) form a rigid unit, so they always sit side by side.
 * - Within a row, units are ordered to minimise crossing lines, then placed as close as possible to the
 *   middle of their parents / children while keeping a minimum gap.
 * - A child's line always starts from the middle of its two parents (the heart).
 */
export function layoutTree(g: Graph, ids: ID[], rootId: ID, sizes: SizeMap = {}): TreeLayout {
  const inTree = new Set(ids);
  const edges = g.edges.filter((e) => inTree.has(e.from) && inTree.has(e.to));
  const order = new Map(ids.map((id, i) => [id, i]));
  const sizeOf = (id: ID) => sizes[id] ?? { w: NODE_W, h: NODE_H };

  const add = (map: Map<ID, ID[]>, key: ID, value: ID) => {
    const list = map.get(key);
    if (list) {
      if (!list.includes(value)) list.push(value);
    } else map.set(key, [value]);
  };

  // ---- relations -------------------------------------------------------------------------------------
  const rawParents = new Map<ID, ID[]>();
  const partners = new Map<ID, ID[]>();
  const walk = new Map<ID, { to: ID; d: number }[]>();
  const addWalk = (from: ID, to: ID, d: number) => {
    const list = walk.get(from);
    if (list) list.push({ to, d });
    else walk.set(from, [{ to, d }]);
  };
  for (const e of edges) {
    if (e.type === 'parent') {
      add(rawParents, e.to, e.from);
      addWalk(e.from, e.to, 1);
      addWalk(e.to, e.from, -1);
    } else {
      if (e.type === 'partner') {
        add(partners, e.from, e.to);
        add(partners, e.to, e.from);
      }
      addWalk(e.from, e.to, 0);
      addWalk(e.to, e.from, 0);
    }
  }

  // A child with a single recorded parent whose partner is the only partner they have is drawn as the
  // couple's child, so the line comes from the heart rather than from just one of them.
  const effParents = new Map<ID, ID[]>();
  for (const id of ids) {
    let ps = [...(rawParents.get(id) ?? [])];
    if (ps.length === 1) {
      const mates = partners.get(ps[0]!) ?? [];
      if (mates.length === 1 && mates[0] !== id) ps = [ps[0]!, mates[0]!];
    }
    if (ps.length) effParents.set(id, ps.slice(0, 2));
  }
  const effChildren = new Map<ID, ID[]>();
  for (const id of ids) for (const p of effParents.get(id) ?? []) add(effChildren, p, id);

  // ---- 1. generations: breadth-first from the root; conflicting edges are ignored rather than fatal ----
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

  // ---- 2. units --------------------------------------------------------------------------------------
  const links: { a: ID; b: ID; kind: LinkKind }[] = [];
  const linkKind = new Map<string, LinkKind>();
  const pairKey = (a: ID, b: ID) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const addLink = (a: ID, b: ID, kind: LinkKind) => {
    if (a === b || gen.get(a) !== gen.get(b)) return;
    const key = pairKey(a, b);
    const known = linkKind.get(key);
    if (known === 'partner') return;
    if (known === 'other' && kind === 'other') return;
    linkKind.set(key, kind);
    if (!known) links.push({ a, b, kind });
    else links.find((l) => pairKey(l.a, l.b) === key)!.kind = kind;
  };
  for (const e of edges) if (e.type === 'partner' || e.type === 'other') addLink(e.from, e.to, e.type);
  for (const id of ids) {
    const ps = effParents.get(id);
    if (ps && ps.length === 2) addLink(ps[0]!, ps[1]!, 'partner');
  }

  const uf = new Map<ID, ID>(ids.map((id) => [id, id]));
  const find = (id: ID): ID => {
    let r = id;
    while (uf.get(r) !== r) r = uf.get(r)!;
    return r;
  };
  for (const l of links) uf.set(find(l.a), find(l.b));
  const adj = new Map<ID, { to: ID; kind: LinkKind }[]>();
  for (const l of links) {
    (adj.get(l.a) ?? adj.set(l.a, []).get(l.a)!).push({ to: l.b, kind: l.kind });
    (adj.get(l.b) ?? adj.set(l.b, []).get(l.b)!).push({ to: l.a, kind: l.kind });
  }
  const buckets = new Map<ID, ID[]>();
  for (const id of ids) {
    const r = find(id);
    (buckets.get(r) ?? buckets.set(r, []).get(r)!).push(id);
  }

  const unitOf = new Map<ID, Unit>();
  const units: Unit[] = [];

  const setOrder = (unit: Unit, members: ID[]) => {
    unit.members = members;
    const centres: number[] = [];
    members.forEach((id, i) => {
      if (i === 0) centres.push(0);
      else {
        const kind = linkKind.get(pairKey(members[i - 1]!, id));
        const gap = kind === 'other' ? GAP_OTHER : GAP_PARTNER;
        centres.push(centres[i - 1]! + sizeOf(members[i - 1]!).w / 2 + gap + sizeOf(id).w / 2);
      }
    });
    const left = -sizeOf(members[0]!).w / 2;
    const right = centres[centres.length - 1]! + sizeOf(members[members.length - 1]!).w / 2;
    const mid = (left + right) / 2;
    unit.w = right - left;
    unit.off = new Map(members.map((id, i) => [id, centres[i]! - mid]));
  };

  const chainOrder = (members: ID[]): ID[] => {
    if (members.length === 1) return members;
    const degree = (id: ID) => adj.get(id)?.length ?? 0;
    const start = [...members].sort((a, b) => degree(a) - degree(b) || order.get(a)! - order.get(b)!)[0]!;
    const out: ID[] = [];
    const seen = new Set<ID>();
    const visit = (id: ID) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
      const next = [...(adj.get(id) ?? [])].sort(
        (x, y) => Number(x.kind === 'other') - Number(y.kind === 'other') || order.get(x.to)! - order.get(y.to)!,
      );
      for (const n of next) visit(n.to);
    };
    visit(start);
    for (const m of members) visit(m);
    return out;
  };

  for (const members of buckets.values()) {
    const unit: Unit = {
      members,
      off: new Map(),
      w: 0,
      gen: gen.get(members[0]!)!,
      x: 0,
      first: Math.min(...members.map((m) => order.get(m)!)),
    };
    setOrder(unit, chainOrder(members));
    units.push(unit);
    for (const m of members) unitOf.set(m, unit);
  }
  units.sort((a, b) => a.first - b.first);

  // ---- 3. initial order: depth-first from the oldest ancestors so families stay together --------------
  const childUnits = (u: Unit): Unit[] => {
    const out: Unit[] = [];
    for (const m of u.members)
      for (const c of effChildren.get(m) ?? []) {
        const cu = unitOf.get(c)!;
        if (cu !== u && !out.includes(cu)) out.push(cu);
      }
    return out;
  };
  const seenUnits = new Set<Unit>();
  const sequence: Unit[] = [];
  const place = (u: Unit) => {
    if (seenUnits.has(u)) return;
    seenUnits.add(u);
    sequence.push(u);
    for (const c of childUnits(u)) place(c);
  };
  const topUnits = units.filter((u) => !u.members.some((m) => effParents.get(m)?.length)).sort((a, b) => a.gen - b.gen || a.first - b.first);
  for (const u of topUnits) place(u);
  for (const u of units) place(u);

  const rows = new Map<number, Unit[]>();
  for (const u of sequence) {
    const row = rows.get(u.gen);
    if (row) row.push(u);
    else rows.set(u.gen, [u]);
  }
  const gens = [...rows.keys()].sort((a, b) => a - b);
  const minGen = gens[0]!;
  const maxGen = gens[gens.length - 1]!;

  const personX = (id: ID) => unitOf.get(id)!.x + unitOf.get(id)!.off.get(id)!;
  const anchorOf = (id: ID): number | null => {
    const ps = effParents.get(id);
    return ps && ps.length ? mean(ps.map(personX)) : null;
  };

  const parentSet = (u: Unit): Set<ID> => {
    const s = new Set<ID>();
    for (const m of u.members) for (const p of effParents.get(m) ?? []) s.add(p);
    return s;
  };
  const gapOf = (a: Unit, b: Unit): number => {
    const pa = parentSet(a);
    let related = false;
    if (pa.size) for (const p of parentSet(b)) if (pa.has(p)) related = true;
    return (a.w + b.w) / 2 + (related ? GAP_SIBLING : GAP_COUSIN);
  };
  const gapsFor = (row: Unit[]) => row.slice(1).map((u, i) => gapOf(row[i]!, u));

  // initial packing
  for (const row of rows.values()) {
    row.forEach((u, i) => {
      u.x = i === 0 ? u.w / 2 : row[i - 1]!.x + gapOf(row[i - 1]!, u);
    });
  }

  // where a unit would like to be: under its members' parents and over its members' children
  const desiredX = (u: Unit, useParents: boolean, useChildren: boolean): number | null => {
    const wants: number[] = [];
    if (useParents) {
      for (const m of u.members) {
        const a = anchorOf(m);
        if (a !== null) wants.push(a - u.off.get(m)!);
      }
    }
    if (useChildren) {
      const families = new Map<string, { parents: ID[]; kids: ID[] }>();
      for (const m of u.members) {
        for (const c of effChildren.get(m) ?? []) {
          const ps = effParents.get(c)!.filter((p) => unitOf.get(p) === u);
          const key = ps.slice().sort().join('|');
          const fam = families.get(key);
          if (fam) fam.kids.push(c);
          else families.set(key, { parents: ps, kids: [c] });
        }
      }
      for (const fam of families.values()) {
        if (!fam.parents.length) continue;
        wants.push(mean(fam.kids.map(personX)) - mean(fam.parents.map((p) => u.off.get(p)!)));
      }
    }
    return wants.length ? mean(wants) : null;
  };

  const settleRow = (g0: number) => {
    const row = rows.get(g0);
    if (!row) return;
    const desired = row.map((u) => desiredX(u, true, true) ?? u.x);
    const placed = projectOrdered(desired, gapsFor(row));
    row.forEach((u, i) => {
      u.x = placed[i]!;
    });
  };
  const settleAll = (rounds: number) => {
    for (let r = 0; r < rounds; r++) {
      for (let g0 = minGen; g0 <= maxGen; g0++) settleRow(g0);
      for (let g0 = maxGen; g0 >= minGen; g0--) settleRow(g0);
    }
  };

  // ---- 4. cut down crossings: reorder rows by the average position of their relatives ------------------
  const reorderRow = (g0: number, byParents: boolean) => {
    const row = rows.get(g0);
    if (!row || row.length < 2) return;
    const keyOf = (u: Unit): number => {
      if (byParents) {
        const anchors = u.members.map(anchorOf).filter((a): a is number => a !== null);
        return anchors.length ? mean(anchors) : u.x;
      }
      const kids: number[] = [];
      for (const m of u.members) for (const c of effChildren.get(m) ?? []) kids.push(personX(c));
      return kids.length ? mean(kids) : u.x;
    };
    const keyed = row.map((u, i) => ({ u, i, key: keyOf(u) }));
    keyed.sort((a, b) => a.key - b.key || a.i - b.i);
    rows.set(g0, keyed.map((k) => k.u));

    if (byParents) {
      // put the member whose parents are on the left on the left
      for (const u of row) {
        if (u.members.length !== 2) continue;
        const [a, b] = u.members as [ID, ID];
        const pa = anchorOf(a);
        const pb = anchorOf(b);
        let flip = false;
        if (pa !== null && pb !== null) flip = pa > pb + 1e-6;
        else if (pa !== null) flip = pa > u.x;
        else if (pb !== null) flip = pb < u.x;
        if (flip) setOrder(u, [b, a]);
      }
    }
    settleRow(g0);
  };

  const crossings = (): number => {
    let total = 0;
    for (const row of rows.values()) {
      const items: { fam: string; a: number; c: number }[] = [];
      for (const u of row)
        for (const m of u.members) {
          const ps = effParents.get(m);
          if (ps?.length) items.push({ fam: ps.join('|'), a: mean(ps.map(personX)), c: personX(m) });
        }
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const p = items[i]!;
          const q = items[j]!;
          if (p.fam !== q.fam && (p.a - q.a) * (p.c - q.c) < -1e-6) total++;
        }
    }
    return total;
  };
  const score = (): number => {
    let length = 0;
    for (const id of ids) {
      const a = anchorOf(id);
      if (a !== null) length += Math.abs(personX(id) - a);
    }
    return crossings() * 1e6 + length;
  };

  const snapshot = () => ({
    rows: new Map([...rows].map(([k, v]) => [k, [...v]] as const)),
    state: units.map((u) => ({ u, x: u.x, members: [...u.members] })),
  });
  const restore = (s: ReturnType<typeof snapshot>) => {
    for (const [k, v] of s.rows) rows.set(k, [...v]);
    for (const { u, x, members } of s.state) {
      setOrder(u, members);
      u.x = x;
    }
  };

  settleAll(10);
  let best = snapshot();
  let bestScore = score();
  for (let pass = 0; pass < 8 && bestScore >= 1e6; pass++) {
    for (let g0 = minGen + 1; g0 <= maxGen; g0++) reorderRow(g0, true);
    for (let g0 = maxGen - 1; g0 >= minGen; g0--) reorderRow(g0, false);
    settleAll(6);
    const s = score();
    if (s < bestScore - 1e-6) {
      best = snapshot();
      bestScore = s;
    }
  }
  restore(best);
  settleAll(2);

  // ---- 5. coordinates --------------------------------------------------------------------------------
  const rowH = new Map<number, number>();
  for (let g0 = minGen; g0 <= maxGen; g0++) {
    const row = rows.get(g0) ?? [];
    rowH.set(g0, Math.max(NODE_H, ...row.flatMap((u) => u.members.map((m) => sizeOf(m).h))));
  }
  const rowY = new Map<number, number>([[0, 0]]);
  for (let g0 = 1; g0 <= maxGen; g0++) rowY.set(g0, rowY.get(g0 - 1)! + rowH.get(g0 - 1)! / 2 + ROW_GAP + rowH.get(g0)! / 2);
  for (let g0 = -1; g0 >= minGen; g0--) rowY.set(g0, rowY.get(g0 + 1)! - rowH.get(g0 + 1)! / 2 - ROW_GAP - rowH.get(g0)! / 2);

  const shift = personX(rootId);
  const nodes: Record<ID, PlacedNode> = {};
  for (const id of ids) {
    const g1 = gen.get(id)!;
    const { w, h } = sizeOf(id);
    nodes[id] = { id, x: personX(id) - shift, y: rowY.get(g1) ?? 0, gen: g1, w, h };
  }

  // ---- 6. connectors ---------------------------------------------------------------------------------
  const connectors: Connector[] = [];
  const adjacentInRow = (a: ID, b: ID): boolean => {
    const ua = unitOf.get(a)!;
    if (ua !== unitOf.get(b)) return false;
    return Math.abs(ua.members.indexOf(a) - ua.members.indexOf(b)) === 1;
  };
  /** The point halfway across the gap between two neighbouring cards (where the heart sits). */
  const gapCentre = (a: PlacedNode, b: PlacedNode) => {
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    return (l.x + l.w / 2 + r.x - r.w / 2) / 2;
  };

  for (const e of edges) {
    if (e.type === 'parent') continue;
    const a = nodes[e.from]!;
    const b = nodes[e.to]!;
    const [left, right] = a.x <= b.x ? [a, b] : [b, a];
    if (e.type === 'partner') {
      if (adjacentInRow(a.id, b.id)) {
        connectors.push({
          id: e.id,
          kind: 'partner',
          d: `M ${left.x + left.w / 2} ${left.y} L ${right.x - right.w / 2} ${right.y}`,
          labelX: gapCentre(a, b),
          labelY: (left.y + right.y) / 2,
        });
      } else {
        const y = Math.max(a.y + a.h / 2, b.y + b.h / 2);
        connectors.push({
          id: e.id,
          kind: 'partner',
          d: `M ${a.x} ${a.y + a.h / 2} Q ${(a.x + b.x) / 2} ${y + 46} ${b.x} ${b.y + b.h / 2}`,
        });
      }
    } else {
      const top = Math.min(a.y - a.h / 2, b.y - b.h / 2);
      const mx = (a.x + b.x) / 2;
      connectors.push({
        id: e.id,
        kind: 'other',
        d: `M ${a.x} ${a.y - a.h / 2} Q ${mx} ${top - 56} ${b.x} ${b.y - b.h / 2}`,
        label: e.label,
        labelX: mx,
        labelY: top - 30,
      });
    }
  }

  interface Family {
    key: string;
    parents: ID[];
    kids: ID[];
  }
  const families = new Map<string, Family>();
  for (const id of ids) {
    const ps = effParents.get(id);
    if (!ps?.length) continue;
    const key = [...ps].sort().join('|');
    const fam = families.get(key);
    if (fam) fam.kids.push(id);
    else families.set(key, { key, parents: [...ps].sort(), kids: [id] });
  }

  interface Drawn {
    fam: Family;
    starts: { x: number; y: number }[];
    left: number;
    right: number;
    parentGen: number;
  }
  const drawn: Drawn[] = [];
  for (const fam of families.values()) {
    const ps = fam.parents.map((id) => nodes[id]!);
    const kids = fam.kids.map((id) => nodes[id]!);
    const starts: { x: number; y: number }[] = [];
    const [pa, pb] = fam.parents;
    if (fam.parents.length === 2 && ps[0]!.gen === ps[1]!.gen && adjacentInRow(pa!, pb!)) {
      starts.push({ x: gapCentre(ps[0]!, ps[1]!), y: ps[0]!.y });
    } else {
      for (const p of ps) starts.push({ x: p.x, y: p.y + p.h / 2 });
    }
    const xs = [...starts.map((s) => s.x), ...kids.map((k) => k.x)];
    drawn.push({ fam, starts, left: Math.min(...xs), right: Math.max(...xs), parentGen: Math.max(...ps.map((p) => p.gen)) });
  }

  // give overlapping horizontal bars of the same row different heights so they never merge
  const byGen = new Map<number, Drawn[]>();
  for (const d of drawn) (byGen.get(d.parentGen) ?? byGen.set(d.parentGen, []).get(d.parentGen)!).push(d);
  for (const [g0, list] of byGen) {
    list.sort((a, b) => a.left - b.left || a.right - b.right);
    const levelEnds: number[] = [];
    for (const d of list) {
      let level = levelEnds.findIndex((end) => end < d.left - 6);
      if (level === -1) level = levelEnds.length;
      levelEnds[level] = d.right;
      const busY = (rowY.get(g0) ?? 0) + (rowH.get(g0) ?? NODE_H) / 2 + BUS_START + (level % BUS_LEVELS) * BUS_STEP;
      const parts: string[] = [];
      for (const s of d.starts) parts.push(`M ${s.x} ${s.y} V ${busY}`);
      parts.push(`M ${d.left} ${busY} H ${d.right}`);
      for (const k of d.fam.kids) {
        const n = nodes[k]!;
        parts.push(`M ${n.x} ${busY} V ${n.y - n.h / 2}`);
      }
      connectors.push({ id: `fam_${d.fam.key}`, kind: 'parent', d: parts.join(' ') });
    }
  }

  const all = Object.values(nodes);
  const bounds: Bounds = {
    minX: Math.min(...all.map((n) => n.x - n.w / 2)),
    maxX: Math.max(...all.map((n) => n.x + n.w / 2)),
    minY: Math.min(...all.map((n) => n.y - n.h / 2)),
    maxY: Math.max(...all.map((n) => n.y + n.h / 2)),
  };
  return { rootId, ids, nodes, connectors, bounds };
}

/**
 * One layout per separate tree. The tree containing `meId` comes first and is rooted at that person,
 * so the view is built around you; other trees are rooted at their first person.
 */
export function layoutAll(g: Graph, meId: ID | null, sizes: SizeMap = {}): TreeLayout[] {
  const comps = findComponents(g);
  const layouts = comps.map((ids) => layoutTree(g, ids, meId && ids.includes(meId) ? meId : ids[0]!, sizes));
  layouts.sort((a, b) => Number(b.ids.includes(meId ?? '')) - Number(a.ids.includes(meId ?? '')));
  return layouts;
}

/** How many separate trees would exist if `id` were removed (used to warn before deleting). */
export function componentsWithout(g: Graph, id: ID): number {
  const people = { ...g.people };
  delete people[id];
  return findComponents({ people, edges: g.edges.filter((e) => e.from !== id && e.to !== id) }).length;
}
