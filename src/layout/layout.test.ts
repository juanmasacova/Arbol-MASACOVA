import { describe, expect, it } from 'vitest';
import { defaultTree } from '../model/defaultTree';
import { parentsOf } from '../model/graph';
import type { ID, Tree } from '../model/types';
import { planAdd, type AddInput } from '../relations/relations';
import { componentsWithout, findComponents, layoutAll, layoutTree, NODE_W, projectOrdered, ROW_H } from './layout';

function add(tree: Tree, source: ID, input: AddInput): { tree: Tree; id: ID } {
  const choices: Record<number, ID> = { ...input.choices };
  let plan = planAdd(tree, source, { ...input, choices });
  // answer any "which one?" questions with the first candidate
  while (plan.status === 'choice') {
    choices[plan.step] = plan.candidates[0]!;
    plan = planAdd(tree, source, { ...input, choices });
  }
  if (plan.status !== 'ok') throw new Error(plan.status);
  const people = { ...tree.people };
  for (const p of plan.people) people[p.id] = p;
  return { tree: { ...tree, people, edges: [...tree.edges, ...plan.edges], counter: plan.counter }, id: plan.focusId };
}

/** me + both parents + 2 siblings + partner + 2 kids + 4 grandparents + aunt + cousin */
function bigFamily() {
  let tree = defaultTree();
  const me = Object.keys(tree.people)[0]!;
  const steps: [AddInput][] = [
    [{ kind: 'parent' }], [{ kind: 'parent' }], [{ kind: 'sibling' }], [{ kind: 'sibling' }],
    [{ kind: 'partner' }], [{ kind: 'child' }], [{ kind: 'child' }],
  ];
  for (const [s] of steps) tree = add(tree, me, s).tree;
  const [mom, dad] = parentsOf(tree, me) as [ID, ID];
  tree = add(tree, mom, { kind: 'parent' }).tree;
  tree = add(tree, mom, { kind: 'parent' }).tree;
  tree = add(tree, dad, { kind: 'parent' }).tree;
  tree = add(tree, dad, { kind: 'parent' }).tree;
  tree = add(tree, me, { kind: 'auntUncle', choices: {} } as AddInput).tree;
  return { tree, me, mom, dad };
}

function rowsOf(layout: ReturnType<typeof layoutTree>) {
  const rows = new Map<number, { id: ID; x: number }[]>();
  for (const n of Object.values(layout.nodes)) {
    const row = rows.get(n.gen) ?? [];
    row.push({ id: n.id, x: n.x });
    rows.set(n.gen, row);
  }
  for (const row of rows.values()) row.sort((a, b) => a.x - b.x);
  return rows;
}

describe('projectOrdered', () => {
  it('keeps desired positions when there is room', () => {
    expect(projectOrdered([0, 500, 900], [100, 100])).toEqual([0, 500, 900]);
  });
  it('spreads items that want the same spot, centred on it', () => {
    expect(projectOrdered([100, 100, 100], [50, 50])).toEqual([50, 100, 150]);
  });
  it('preserves order and minimum gaps', () => {
    const out = projectOrdered([300, 10, 20], [40, 40]);
    expect(out[1]! - out[0]!).toBeGreaterThanOrEqual(40 - 1e-9);
    expect(out[2]! - out[1]!).toBeGreaterThanOrEqual(40 - 1e-9);
  });
});

describe('findComponents', () => {
  it('treats unconnected people as separate trees', () => {
    let tree = defaultTree();
    const first = Object.keys(tree.people)[0]!;
    tree = add(tree, first, { kind: 'child' }).tree;
    const lone = { ...tree.people, p_loneperson1: { ...tree.people[first]!, id: 'p_loneperson1', name: 'Lone' } };
    const comps = findComponents({ people: lone, edges: tree.edges });
    expect(comps).toHaveLength(2);
    expect(comps.map((c) => c.length).sort()).toEqual([1, 2]);
  });

  it('counts how many trees a deletion would leave', () => {
    const tree = defaultTree();
    const me = Object.keys(tree.people)[0]!;
    const { tree: next, id: child } = add(tree, me, { kind: 'child' });
    const grand = add(next, child, { kind: 'child' });
    expect(componentsWithout(grand.tree, child)).toBe(2);
  });
});

describe('layoutTree', () => {
  it('puts the root at x=0,y=0 and ancestors above descendants', () => {
    const { tree, me, mom } = bigFamily();
    const [layout] = layoutAll(tree, me);
    expect(layout!.nodes[me]).toMatchObject({ x: 0, y: 0, gen: 0 });
    expect(layout!.nodes[mom]!.y).toBe(-ROW_H);
  });

  it('assigns every person a position, with no two people overlapping in a row', () => {
    const { tree, me } = bigFamily();
    const [layout] = layoutAll(tree, me);
    expect(Object.keys(layout!.nodes)).toHaveLength(Object.keys(tree.people).length);
    for (const row of rowsOf(layout!).values()) {
      for (let i = 1; i < row.length; i++) expect(row[i]!.x - row[i - 1]!.x).toBeGreaterThanOrEqual(NODE_W);
    }
  });

  it('centres a couple above their children', () => {
    let tree = defaultTree();
    const me = Object.keys(tree.people)[0]!;
    tree = add(tree, me, { kind: 'partner' }).tree;
    const kids = [add(tree, me, { kind: 'child' }), null] as const;
    tree = kids[0].tree;
    tree = add(tree, me, { kind: 'child' }).tree;
    tree = add(tree, me, { kind: 'child' }).tree;
    const layout = layoutTree(tree, Object.keys(tree.people), me);
    const couple = Object.values(layout.nodes).filter((n) => n.gen === 0);
    const kidNodes = Object.values(layout.nodes).filter((n) => n.gen === 1);
    const coupleMid = couple.reduce((s, n) => s + n.x, 0) / couple.length;
    const kidMid = kidNodes.reduce((s, n) => s + n.x, 0) / kidNodes.length;
    expect(Math.abs(coupleMid - kidMid)).toBeLessThan(1);
  });

  it('emits a connector path for each family and partner link', () => {
    const { tree, me } = bigFamily();
    const [layout] = layoutAll(tree, me);
    expect(layout!.connectors.some((c) => c.kind === 'parent')).toBe(true);
    expect(layout!.connectors.some((c) => c.kind === 'partner')).toBe(true);
    for (const c of layout!.connectors) expect(c.d).not.toMatch(/NaN|undefined/);
  });

  it('never produces NaN positions, even for conflicting generations', () => {
    let tree = defaultTree();
    const me = Object.keys(tree.people)[0]!;
    const a = add(tree, me, { kind: 'child' });
    const b = add(a.tree, a.id, { kind: 'child' });
    // contradictory: link grandchild as a partner of the root (same row) while also two rows below
    const edges = [...b.tree.edges, { id: 'e_conflict01', type: 'partner' as const, from: me, to: b.id, label: '' }];
    const layout = layoutTree({ people: b.tree.people, edges }, Object.keys(b.tree.people), me);
    for (const n of Object.values(layout.nodes)) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('lays out separate trees independently and roots the “me” tree first', () => {
    let tree = defaultTree();
    const first = Object.keys(tree.people)[0]!;
    tree = add(tree, first, { kind: 'child' }).tree;
    const loneId = 'p_loneperson2';
    tree = { ...tree, people: { ...tree.people, [loneId]: { ...tree.people[first]!, id: loneId, name: 'Lone' } } };
    const layouts = layoutAll(tree, loneId);
    expect(layouts).toHaveLength(2);
    expect(layouts[0]!.rootId).toBe(loneId);
  });
});
