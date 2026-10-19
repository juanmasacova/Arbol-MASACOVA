import { blankPerson, childrenOf, displayName, parentsOf, partnersOf, siblingsOf } from '../model/graph';
import { newId } from '../model/ids';
import type { Edge, EdgeType, Graph, ID, Person } from '../model/types';

export type RelationKind =
  | 'parent'
  | 'partner'
  | 'sibling'
  | 'child'
  | 'grandparent'
  | 'greatGrandparent'
  | 'greatGreatGrandparent'
  | 'auntUncle'
  | 'greatAuntUncle'
  | 'cousin'
  | 'nephewNiece'
  | 'grandchild'
  | 'greatGrandchild'
  | 'other';

export type RelationGroup = 'Close family' | 'Ancestors' | 'Extended family' | 'Descendants' | 'Anyone else';

export interface RelationOption {
  kind: RelationKind;
  label: string;
  group: RelationGroup;
}

export const RELATION_OPTIONS: RelationOption[] = [
  { kind: 'parent', label: 'Parent', group: 'Close family' },
  { kind: 'partner', label: 'Partner', group: 'Close family' },
  { kind: 'sibling', label: 'Sibling', group: 'Close family' },
  { kind: 'child', label: 'Son / daughter', group: 'Close family' },
  { kind: 'grandparent', label: 'Grandparent', group: 'Ancestors' },
  { kind: 'greatGrandparent', label: 'Great-grandparent', group: 'Ancestors' },
  { kind: 'greatGreatGrandparent', label: 'Great-great-grandparent', group: 'Ancestors' },
  { kind: 'auntUncle', label: 'Aunt / uncle', group: 'Extended family' },
  { kind: 'greatAuntUncle', label: 'Great-aunt / uncle', group: 'Extended family' },
  { kind: 'cousin', label: 'Cousin', group: 'Extended family' },
  { kind: 'nephewNiece', label: 'Nephew / niece', group: 'Extended family' },
  { kind: 'grandchild', label: 'Grandchild', group: 'Descendants' },
  { kind: 'greatGrandchild', label: 'Great-grandchild', group: 'Descendants' },
  { kind: 'other', label: 'Other connection…', group: 'Anyone else' },
];

type Op = 'up' | 'down' | 'side' | 'partner';

/**
 * One step along a path through the tree.
 * `create: true` marks the final step, which always makes the new person.
 * Earlier steps reuse an existing person if one fits (asking which, if several), or create a placeholder.
 */
interface Step {
  op: Op;
  create: boolean;
  ask?: string;
}

const up = (ask = 'Through which parent?'): Step => ({ op: 'up', create: false, ask });
const down = (ask = 'Through which child?'): Step => ({ op: 'down', create: false, ask });
const side = (ask: string): Step => ({ op: 'side', create: false, ask });
const make = (op: Op): Step => ({ op, create: true });

const PATHS: Record<Exclude<RelationKind, 'other'>, Step[]> = {
  parent: [make('up')],
  partner: [make('partner')],
  sibling: [make('side')],
  child: [make('down')],
  grandparent: [up(), make('up')],
  greatGrandparent: [up(), up('Through which grandparent?'), make('up')],
  greatGreatGrandparent: [up(), up('Through which grandparent?'), up('Through which great-grandparent?'), make('up')],
  auntUncle: [up(), make('side')],
  greatAuntUncle: [up(), up('Through which grandparent?'), make('side')],
  cousin: [up(), side('Which aunt or uncle?'), make('down')],
  nephewNiece: [side('Which sibling?'), make('down')],
  grandchild: [down(), make('down')],
  greatGrandchild: [down(), down('Through which grandchild?'), make('down')],
};

export interface AddInput {
  kind: RelationKind;
  /** For kind "other": what the connection is (e.g. "Godfather", "Family friend"). */
  label?: string;
  /** Answers to "which one?" questions, keyed by step index. */
  choices?: Record<number, ID>;
}

export type PlanResult =
  | { status: 'ok'; people: Person[]; edges: Edge[]; focusId: ID; counter: number }
  | { status: 'choice'; step: number; question: string; candidates: ID[] }
  | { status: 'error'; message: string };

/**
 * Work out which people and edges must be added so that a new person ends up related to `sourceId`
 * the way `input.kind` says. Pure: it never mutates the tree it is given.
 */
export function planAdd(tree: Graph & { counter: number }, sourceId: ID, input: AddInput): PlanResult {
  if (!tree.people[sourceId]) return { status: 'error', message: 'That person no longer exists.' };

  const draft: Graph = { people: { ...tree.people }, edges: [...tree.edges] };
  const newPeople: Person[] = [];
  const newEdges: Edge[] = [];
  let counter = tree.counter;

  const makePerson = (placeholder: boolean): Person => {
    const name = placeholder ? 'Unknown' : `Person ${++counter}`;
    const person = blankPerson(newId('p'), name, placeholder);
    draft.people[person.id] = person;
    newPeople.push(person);
    return person;
  };
  const link = (type: EdgeType, from: ID, to: ID, label = ''): void => {
    const edge: Edge = { id: newId('e'), type, from, to, label };
    draft.edges.push(edge);
    newEdges.push(edge);
  };

  if (input.kind === 'other') {
    const person = makePerson(false);
    link('other', sourceId, person.id, (input.label ?? '').trim().slice(0, 60) || 'Connection');
    return { status: 'ok', people: newPeople, edges: newEdges, focusId: person.id, counter };
  }

  const path = PATHS[input.kind];
  let current: ID = sourceId;

  for (let i = 0; i < path.length; i++) {
    const step = path[i]!;

    if (step.op === 'partner') {
      const person = makePerson(false);
      link('partner', current, person.id);
      return { status: 'ok', people: newPeople, edges: newEdges, focusId: person.id, counter };
    }

    if (step.op === 'up') {
      const parents = parentsOf(draft, current);
      if (step.create) {
        if (parents.length >= 2) {
          return {
            status: 'error',
            message: `${displayName(draft.people[current])} already has two parents. Use “Other connection” for step- or adoptive parents.`,
          };
        }
        const person = makePerson(false);
        link('parent', person.id, current);
        const [existing] = parents;
        if (existing) link('partner', existing, person.id);
        return { status: 'ok', people: newPeople, edges: newEdges, focusId: person.id, counter };
      }
      if (parents.length === 0) {
        const placeholder = makePerson(true);
        link('parent', placeholder.id, current);
        current = placeholder.id;
      } else if (parents.length === 1) {
        current = parents[0]!;
      } else {
        const picked = input.choices?.[i];
        if (!picked || !parents.includes(picked)) {
          return { status: 'choice', step: i, question: step.ask ?? 'Which one?', candidates: parents };
        }
        current = picked;
      }
      continue;
    }

    if (step.op === 'down') {
      if (step.create) {
        const person = makePerson(false);
        link('parent', current, person.id);
        const partners = partnersOf(draft, current);
        if (partners.length === 1) link('parent', partners[0]!, person.id);
        return { status: 'ok', people: newPeople, edges: newEdges, focusId: person.id, counter };
      }
      const children = childrenOf(draft, current);
      if (children.length === 0) {
        const placeholder = makePerson(true);
        link('parent', current, placeholder.id);
        current = placeholder.id;
      } else if (children.length === 1) {
        current = children[0]!;
      } else {
        const picked = input.choices?.[i];
        if (!picked || !children.includes(picked)) {
          return { status: 'choice', step: i, question: step.ask ?? 'Which one?', candidates: children };
        }
        current = picked;
      }
      continue;
    }

    // op === 'side': a sibling of `current`; needs parents, so make a placeholder one if there are none
    let parents = parentsOf(draft, current);
    if (parents.length === 0) {
      const placeholder = makePerson(true);
      link('parent', placeholder.id, current);
      parents = [placeholder.id];
    }
    if (step.create) {
      const person = makePerson(false);
      for (const parent of parents.slice(0, 2)) link('parent', parent, person.id);
      return { status: 'ok', people: newPeople, edges: newEdges, focusId: person.id, counter };
    }
    const siblings = siblingsOf(draft, current);
    if (siblings.length === 0) {
      const placeholder = makePerson(true);
      for (const parent of parents.slice(0, 2)) link('parent', parent, placeholder.id);
      current = placeholder.id;
    } else if (siblings.length === 1) {
      current = siblings[0]!;
    } else {
      const picked = input.choices?.[i];
      if (!picked || !siblings.includes(picked)) {
        return { status: 'choice', step: i, question: step.ask ?? 'Which one?', candidates: siblings };
      }
      current = picked;
    }
  }

  return { status: 'error', message: 'Could not work out that relationship.' };
}
