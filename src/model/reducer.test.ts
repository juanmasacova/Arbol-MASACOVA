import { describe, expect, it } from 'vitest';
import { defaultTree } from './defaultTree';
import { historyReducer, initHistory, treeReducer } from './reducer';
import { planAdd } from '../relations/relations';
import type { ID, Tree } from './types';

const first = (t: ReturnType<typeof defaultTree>) => Object.keys(t.people)[0]!;

describe('treeReducer', () => {
  it('editing a placeholder turns it into a real person and clamps long text', () => {
    let tree = defaultTree();
    const me = first(tree);
    const plan = planAdd(tree, me, { kind: 'parent' });
    if (plan.status !== 'ok') throw new Error();
    tree = treeReducer(tree, { type: 'applyPlan', plan });
    const placeholderPlan = planAdd(tree, me, { kind: 'grandparent' });
    if (placeholderPlan.status !== 'ok') throw new Error();
    tree = treeReducer(tree, { type: 'applyPlan', plan: placeholderPlan });
    const ph = Object.values(tree.people).find((p) => p.placeholder);
    if (ph) {
      tree = treeReducer(tree, { type: 'updatePerson', id: ph.id, patch: { name: 'x'.repeat(500) } });
      expect(tree.people[ph.id]!.placeholder).toBe(false);
      expect(tree.people[ph.id]!.name.length).toBe(120);
    }
  });

  it('deleting a person removes their edges and source tags, and clears “me”', () => {
    let tree = defaultTree();
    const me = first(tree);
    const plan = planAdd(tree, me, { kind: 'child' });
    if (plan.status !== 'ok') throw new Error();
    tree = treeReducer(tree, { type: 'applyPlan', plan });
    const child = plan.focusId;
    tree = treeReducer(tree, { type: 'setMe', id: child });
    tree = treeReducer(tree, {
      type: 'addSource',
      source: { id: 's_aaaaaaaa', url: 'https://x.example.com/', title: '', excerpt: '', personIds: [child, me], addedAt: '' },
    });
    tree = treeReducer(tree, { type: 'deletePerson', id: child });
    expect(tree.people[child]).toBeUndefined();
    expect(tree.edges).toHaveLength(0);
    expect(tree.meId).toBeNull();
    expect(tree.sources[0]!.personIds).toEqual([me]);
  });

  it('never deletes the last remaining person', () => {
    const tree = defaultTree();
    expect(treeReducer(tree, { type: 'deletePerson', id: first(tree) })).toBe(tree);
  });

  it('removes any single connection by hand', () => {
    let tree = defaultTree();
    const me = first(tree);
    const parentPlan = planAdd(tree, me, { kind: 'parent' });
    if (parentPlan.status !== 'ok') throw new Error();
    tree = treeReducer(tree, { type: 'applyPlan', plan: parentPlan });
    const edgeId = tree.edges[0]!.id;
    expect(treeReducer(tree, { type: 'removeEdge', id: edgeId }).edges).toHaveLength(0);
  });

  it('adds an unconnected person for a separate tree', () => {
    const tree = treeReducer(defaultTree(), { type: 'addLoose', id: 'p_loose0001' });
    expect(Object.keys(tree.people)).toHaveLength(2);
    expect(tree.edges).toHaveLength(0);
  });
});

describe('historyReducer', () => {
  it('undoes and redoes', () => {
    let h = initHistory(defaultTree());
    const me = first(h.present);
    h = historyReducer(h, { type: 'setMe', id: me }, 0);
    expect(h.present.meId).toBe(me);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.meId).toBeNull();
    h = historyReducer(h, { type: 'redo' });
    expect(h.present.meId).toBe(me);
  });

  it('merges rapid typing in one field into a single undo step', () => {
    let h = initHistory(defaultTree());
    const me = first(h.present);
    h = historyReducer(h, { type: 'updatePerson', id: me, patch: { notes: 'a' } }, 1000);
    h = historyReducer(h, { type: 'updatePerson', id: me, patch: { notes: 'ab' } }, 1200);
    h = historyReducer(h, { type: 'updatePerson', id: me, patch: { notes: 'abc' } }, 1400);
    expect(h.past).toHaveLength(1);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.people[me]!.notes).toBe('');
  });

  it('keeps at most 30 undo steps', () => {
    let h = initHistory(defaultTree());
    for (let i = 0; i < 45; i++) h = historyReducer(h, { type: 'addLoose', id: `p_loose${i.toString().padStart(4, '0')}` }, i * 10_000);
    expect(h.past).toHaveLength(30);
  });
});

describe('manual connections and dragging', () => {
  const build = () => {
    let tree = defaultTree();
    const me = first(tree);
    const mom = planAdd(tree, me, { kind: 'parent' });
    if (mom.status !== 'ok') throw new Error();
    tree = treeReducer(tree, { type: 'applyPlan', plan: mom });
    const lone1 = treeReducer(tree, { type: 'addLoose', id: 'p_loneone001' });
    const lone2 = treeReducer(lone1, { type: 'addLoose', id: 'p_lonetwo001' });
    return { tree: lone2, me, mom: mom.focusId };
  };

  it('connects two existing people as parent and child', () => {
    const { tree, me } = build();
    const next = treeReducer(tree, { type: 'connect', id: 'e_manual0001', kind: 'child', personId: me, otherId: 'p_loneone001' });
    expect(next.edges.find((e) => e.id === 'e_manual0001')).toMatchObject({ type: 'parent', from: me, to: 'p_loneone001' });
  });

  it('refuses a third parent, duplicates, self links and cycles', () => {
    const { tree, me, mom } = build();
    const dad = treeReducer(tree, { type: 'connect', id: 'e_dad0000001', kind: 'parent', personId: me, otherId: 'p_loneone001' });
    expect(parentsOfIds(dad, me)).toHaveLength(2);
    const third = treeReducer(dad, { type: 'connect', id: 'e_third000001', kind: 'parent', personId: me, otherId: 'p_lonetwo001' });
    expect(third).toBe(dad);
    expect(treeReducer(dad, { type: 'connect', id: 'e_dup0000001', kind: 'parent', personId: me, otherId: mom })).toBe(dad);
    expect(treeReducer(dad, { type: 'connect', id: 'e_self000001', kind: 'partner', personId: me, otherId: me })).toBe(dad);
    // my mother cannot also be my child
    expect(treeReducer(dad, { type: 'connect', id: 'e_cycle00001', kind: 'child', personId: me, otherId: mom })).toBe(dad);
  });

  it('adds a labelled link and removes a family link by hand', () => {
    const { tree, me, mom } = build();
    const linked = treeReducer(tree, { type: 'connect', id: 'e_label00001', kind: 'other', personId: me, otherId: 'p_lonetwo001', label: ' Godmother ' });
    expect(linked.edges.find((e) => e.id === 'e_label00001')?.label).toBe('Godmother');
    const edge = tree.edges.find((e) => e.from === mom)!;
    expect(treeReducer(linked, { type: 'removeEdge', id: edge.id }).edges.some((e) => e.id === edge.id)).toBe(false);
  });

  it('stores a dragged offset and clears it again', () => {
    const { tree, me } = build();
    const moved = treeReducer(tree, { type: 'movePerson', id: me, dx: 40.4, dy: -12 });
    expect(moved.people[me]).toMatchObject({ dx: 40, dy: -12 });
    expect(treeReducer(moved, { type: 'movePerson', id: me, dx: 0, dy: 0 }).people[me]!.dx).toBeUndefined();
    expect(treeReducer(moved, { type: 'resetLayout' }).people[me]!.dy).toBeUndefined();
    expect(treeReducer(tree, { type: 'movePerson', id: me, dx: NaN, dy: 0 })).toBe(tree);
  });

  it('merges a burst of drag steps into one undo step', () => {
    const { tree, me } = build();
    let h = initHistory(tree);
    h = historyReducer(h, { type: 'movePerson', id: me, dx: 10, dy: 0 }, 1000);
    h = historyReducer(h, { type: 'movePerson', id: me, dx: 22, dy: 0 }, 1200);
    expect(h.past).toHaveLength(1);
    expect(historyReducer(h, { type: 'undo' }).present.people[me]!.dx).toBeUndefined();
  });
});

function parentsOfIds(tree: Tree, id: ID): ID[] {
  return tree.edges.filter((e) => e.type === 'parent' && e.to === id).map((e) => e.from);
}
