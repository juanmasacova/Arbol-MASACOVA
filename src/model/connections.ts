import { newId } from './ids';
import type { Edge, Graph, ID } from './types';

/** What the person being edited is to the other person they are being connected to. */
export type ConnectKind = 'parent' | 'child' | 'partner' | 'other';

export const CONNECT_OPTIONS: { kind: ConnectKind; label: string }[] = [
  { kind: 'parent', label: 'is a parent of this person' },
  { kind: 'child', label: 'is a child of this person' },
  { kind: 'partner', label: 'is a partner of this person' },
  { kind: 'other', label: 'has another connection with this person' },
];

const parentsOf = (g: Graph, id: ID) => g.edges.filter((e) => e.type === 'parent' && e.to === id).map((e) => e.from);

/** True if `descendant` can be reached from `ancestor` by following parent → child links. */
function isDescendant(g: Graph, ancestor: ID, descendant: ID): boolean {
  const seen = new Set<ID>([ancestor]);
  const stack = [ancestor];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of g.edges) {
      if (e.type === 'parent' && e.from === id && !seen.has(e.to)) {
        if (e.to === descendant) return true;
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return false;
}

/**
 * Whether linking `otherId` to `personId` this way makes sense. Returns a short explanation when it does not,
 * or null when it is fine. `kind` describes `otherId` relative to `personId` ("parent" = other is their parent).
 */
export function checkConnection(g: Graph, kind: ConnectKind, personId: ID, otherId: ID, label = ''): string | null {
  if (!g.people[personId] || !g.people[otherId]) return 'That person is no longer in the tree.';
  if (personId === otherId) return 'Pick a different person.';

  if (kind === 'parent' || kind === 'child') {
    const parent = kind === 'parent' ? otherId : personId;
    const child = kind === 'parent' ? personId : otherId;
    if (g.edges.some((e) => e.type === 'parent' && e.from === parent && e.to === child)) return 'They are already connected this way.';
    if (parentsOf(g, child).length >= 2) return 'A person can have at most two parents. Remove one first, or use “another connection”.';
    if (parent === child || isDescendant(g, child, parent)) return 'That would make someone their own ancestor.';
    return null;
  }

  const between = g.edges.filter((e) => (e.from === personId && e.to === otherId) || (e.from === otherId && e.to === personId));
  if (kind === 'partner') {
    if (between.some((e) => e.type === 'parent')) return 'A parent and child cannot also be partners.';
    if (between.some((e) => e.type === 'partner')) return 'They are already partners.';
    return null;
  }
  const clean = label.trim();
  if (between.some((e) => e.type === 'other' && e.label === (clean || 'Connection'))) return 'They already have that connection.';
  return null;
}

export function buildEdge(kind: ConnectKind, personId: ID, otherId: ID, label = '', id: ID = newId('e')): Edge {
  const clean = label.trim().slice(0, 60);
  if (kind === 'parent') return { id, type: 'parent', from: otherId, to: personId, label: '' };
  if (kind === 'child') return { id, type: 'parent', from: personId, to: otherId, label: '' };
  if (kind === 'partner') return { id, type: 'partner', from: personId, to: otherId, label: '' };
  return { id, type: 'other', from: personId, to: otherId, label: clean || 'Connection' };
}
