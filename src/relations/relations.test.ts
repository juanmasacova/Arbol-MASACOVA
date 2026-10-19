import { describe, expect, it } from 'vitest';
import { defaultTree } from '../model/defaultTree';
import { childrenOf, parentsOf, partnersOf, siblingsOf } from '../model/graph';
import type { ID, Tree } from '../model/types';
import { planAdd, type AddInput, type PlanResult } from './relations';

function apply(tree: Tree, plan: PlanResult): Tree {
  if (plan.status !== 'ok') throw new Error(`plan was ${plan.status}`);
  const people = { ...tree.people };
  for (const p of plan.people) people[p.id] = p;
  return { ...tree, people, edges: [...tree.edges, ...plan.edges], counter: plan.counter };
}

function add(tree: Tree, source: ID, input: AddInput): { tree: Tree; focusId: ID } {
  const plan = planAdd(tree, source, input);
  if (plan.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(plan)}`);
  return { tree: apply(tree, plan), focusId: plan.focusId };
}

const rootOf = (tree: Tree): ID => Object.keys(tree.people)[0]!;

describe('planAdd: close family', () => {
  it('adds a parent, then a second parent who becomes the first parent’s partner', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    const a = add(tree, me, { kind: 'parent' });
    tree = a.tree;
    const b = add(tree, me, { kind: 'parent' });
    tree = b.tree;
    expect(parentsOf(tree, me).sort()).toEqual([a.focusId, b.focusId].sort());
    expect(partnersOf(tree, a.focusId)).toEqual([b.focusId]);
  });

  it('refuses a third parent', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    tree = add(tree, me, { kind: 'parent' }).tree;
    tree = add(tree, me, { kind: 'parent' }).tree;
    const plan = planAdd(tree, me, { kind: 'parent' });
    expect(plan.status).toBe('error');
  });

  it('adds a sibling under a placeholder parent when the person has no parents', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    const { tree: next, focusId } = add(tree, me, { kind: 'sibling' });
    expect(siblingsOf(next, me)).toEqual([focusId]);
    const [parent] = parentsOf(next, me);
    expect(next.people[parent!]!.placeholder).toBe(true);
    expect(next.people[parent!]!.name).toBe('Unknown');
    expect(next.people[focusId]!.placeholder).toBe(false);
  });

  it('adds a child to both the person and their only partner', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    const partner = add(tree, me, { kind: 'partner' });
    tree = partner.tree;
    const child = add(tree, me, { kind: 'child' });
    expect(parentsOf(child.tree, child.focusId).sort()).toEqual([me, partner.focusId].sort());
  });

  it('names new people Person 2, Person 3…', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    const a = add(tree, me, { kind: 'partner' });
    tree = a.tree;
    const b = add(tree, me, { kind: 'child' });
    expect(a.tree.people[a.focusId]!.name).toBe('Person 2');
    expect(b.tree.people[b.focusId]!.name).toBe('Person 3');
  });
});

describe('planAdd: ancestors', () => {
  it('grandparent creates a placeholder parent in between', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    const { tree: next, focusId } = add(tree, me, { kind: 'grandparent' });
    const [mid] = parentsOf(next, me);
    expect(next.people[mid!]!.placeholder).toBe(true);
    expect(parentsOf(next, mid!)).toEqual([focusId]);
  });

  it('grandparent reuses an existing parent instead of making another', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    const parent = add(tree, me, { kind: 'parent' });
    tree = parent.tree;
    const { tree: next, focusId } = add(tree, me, { kind: 'grandparent' });
    expect(Object.keys(next.people)).toHaveLength(3);
    expect(parentsOf(next, parent.focusId)).toEqual([focusId]);
  });

  it('asks which parent to go through when there are two, then honours the answer', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    const mom = add(tree, me, { kind: 'parent' });
    tree = mom.tree;
    const dad = add(tree, me, { kind: 'parent' });
    tree = dad.tree;

    const first = planAdd(tree, me, { kind: 'grandparent' });
    expect(first.status).toBe('choice');
    if (first.status !== 'choice') return;
    expect(first.candidates.sort()).toEqual([mom.focusId, dad.focusId].sort());

    const done = planAdd(tree, me, { kind: 'grandparent', choices: { [first.step]: dad.focusId } });
    expect(done.status).toBe('ok');
    if (done.status !== 'ok') return;
    expect(done.edges.some((e) => e.type === 'parent' && e.to === dad.focusId)).toBe(true);
  });

  it('great-grandparent and great-great-grandparent are 3 and 4 generations up', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    for (const [kind, depth] of [
      ['greatGrandparent', 3],
      ['greatGreatGrandparent', 4],
    ] as const) {
      const { tree: next, focusId } = add(tree, me, { kind });
      let cursor = me;
      for (let i = 0; i < depth; i++) cursor = parentsOf(next, cursor)[0]!;
      expect(cursor).toBe(focusId);
    }
  });
});

describe('planAdd: extended family', () => {
  it('aunt/uncle is a sibling of a parent, joined through a placeholder grandparent', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    const { tree: next, focusId } = add(tree, me, { kind: 'auntUncle' });
    const [parent] = parentsOf(next, me);
    expect(siblingsOf(next, parent!)).toEqual([focusId]);
    expect(next.people[parent!]!.placeholder).toBe(true);
  });

  it('cousin is the child of a parent’s sibling', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    const { tree: next, focusId } = add(tree, me, { kind: 'cousin' });
    const [parent] = parentsOf(next, me);
    const [uncle] = parentsOf(next, focusId);
    expect(uncle).toBeDefined();
    expect(siblingsOf(next, parent!)).toContain(uncle);
    expect(next.people[uncle!]!.placeholder).toBe(true);
    expect(next.people[focusId]!.placeholder).toBe(false);
  });

  it('cousin reuses an existing aunt/uncle', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    const aunt = add(tree, me, { kind: 'auntUncle' });
    tree = aunt.tree;
    const before = Object.keys(tree.people).length;
    const { tree: next, focusId } = add(tree, me, { kind: 'cousin' });
    expect(Object.keys(next.people).length).toBe(before + 1);
    expect(parentsOf(next, focusId)).toEqual([aunt.focusId]);
  });

  it('nephew/niece is the child of a sibling', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    const { tree: next, focusId } = add(tree, me, { kind: 'nephewNiece' });
    const [sibling] = siblingsOf(next, me);
    expect(parentsOf(next, focusId)).toEqual([sibling]);
  });

  it('great-aunt/uncle is a sibling of a grandparent', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    const { tree: next, focusId } = add(tree, me, { kind: 'greatAuntUncle' });
    const grandparent = parentsOf(next, parentsOf(next, me)[0]!)[0]!;
    expect(siblingsOf(next, grandparent)).toEqual([focusId]);
  });
});

describe('planAdd: descendants and other', () => {
  it('grandchild and great-grandchild go down 2 and 3 generations', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    for (const [kind, depth] of [
      ['grandchild', 2],
      ['greatGrandchild', 3],
    ] as const) {
      const { tree: next, focusId } = add(tree, me, { kind });
      let cursor = focusId;
      for (let i = 0; i < depth; i++) cursor = parentsOf(next, cursor)[0]!;
      expect(cursor).toBe(me);
    }
  });

  it('other connection stores a labelled dashed link', () => {
    const tree = defaultTree();
    const me = rootOf(tree);
    const { tree: next, focusId } = add(tree, me, { kind: 'other', label: '  Godmother ' });
    const edge = next.edges.find((e) => e.type === 'other');
    expect(edge).toMatchObject({ from: me, to: focusId, label: 'Godmother' });
  });

  it('never mutates the tree it is given', () => {
    const tree = defaultTree();
    const snapshot = JSON.stringify(tree);
    planAdd(tree, rootOf(tree), { kind: 'cousin' });
    expect(JSON.stringify(tree)).toBe(snapshot);
  });

  it('every relation keeps the graph free of dangling edges', () => {
    const kinds = [
      'parent', 'partner', 'sibling', 'child', 'grandparent', 'greatGrandparent', 'greatGreatGrandparent',
      'auntUncle', 'greatAuntUncle', 'cousin', 'nephewNiece', 'grandchild', 'greatGrandchild', 'other',
    ] as const;
    for (const kind of kinds) {
      const tree = defaultTree();
      const { tree: next } = add(tree, rootOf(tree), { kind });
      for (const e of next.edges) {
        expect(next.people[e.from], `${kind}: from`).toBeDefined();
        expect(next.people[e.to], `${kind}: to`).toBeDefined();
      }
      expect(childrenOf(next, rootOf(next)).length).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('planAdd: later arrivals join existing children', () => {
  it('links a second parent to siblings who only had the first parent', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    const mom = add(tree, me, { kind: 'parent' });
    tree = mom.tree;
    const sister = add(tree, me, { kind: 'sibling' });
    tree = sister.tree;
    const dad = add(tree, me, { kind: 'parent' });
    tree = dad.tree;
    expect(parentsOf(tree, sister.focusId).sort()).toEqual([mom.focusId, dad.focusId].sort());
    expect(parentsOf(tree, me).sort()).toEqual([mom.focusId, dad.focusId].sort());
  });

  it('makes a new partner the second parent of existing single-parent children', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    const kid = add(tree, me, { kind: 'child' });
    tree = kid.tree;
    const partner = add(tree, me, { kind: 'partner' });
    tree = partner.tree;
    expect(parentsOf(tree, kid.focusId).sort()).toEqual([me, partner.focusId].sort());
  });

  it('does not touch children when the person already had a partner', () => {
    let tree = defaultTree();
    const me = rootOf(tree);
    tree = add(tree, me, { kind: 'partner' }).tree;
    const kid = add(tree, me, { kind: 'child' });
    tree = kid.tree;
    const second = add(tree, me, { kind: 'partner' });
    tree = second.tree;
    expect(parentsOf(tree, kid.focusId)).not.toContain(second.focusId);
  });
});
