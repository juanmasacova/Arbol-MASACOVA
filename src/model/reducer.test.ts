import { describe, expect, it } from 'vitest';
import { defaultTree } from './defaultTree';
import { historyReducer, initHistory, treeReducer } from './reducer';
import { planAdd } from '../relations/relations';

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

  it('only removes free-form "other" links, never family structure', () => {
    let tree = defaultTree();
    const me = first(tree);
    const parentPlan = planAdd(tree, me, { kind: 'parent' });
    if (parentPlan.status !== 'ok') throw new Error();
    tree = treeReducer(tree, { type: 'applyPlan', plan: parentPlan });
    const edgeId = tree.edges[0]!.id;
    expect(treeReducer(tree, { type: 'removeEdge', id: edgeId }).edges).toHaveLength(1);
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
