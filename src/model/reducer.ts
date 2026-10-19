import { blankPerson } from './graph';
import { LIMITS, type FileItem, type ID, type Person, type Source, type Tree } from './types';
import type { PlanResult } from '../relations/relations';

export type EditablePersonFields = Pick<Person, 'name' | 'nickname' | 'born' | 'died' | 'place' | 'notes'>;

export type Action =
  | { type: 'load'; tree: Tree }
  | { type: 'applyPlan'; plan: Extract<PlanResult, { status: 'ok' }> }
  | { type: 'addLoose'; id: ID }
  | { type: 'updatePerson'; id: ID; patch: Partial<EditablePersonFields> }
  | { type: 'setPhoto'; id: ID; photoId: ID | null }
  | { type: 'addFile'; id: ID; file: FileItem }
  | { type: 'removeFile'; id: ID; fileId: ID }
  | { type: 'setMe'; id: ID | null }
  | { type: 'deletePerson'; id: ID }
  | { type: 'removeEdge'; id: ID }
  | { type: 'addSource'; source: Source }
  | { type: 'updateSource'; id: ID; patch: Partial<Pick<Source, 'title' | 'excerpt' | 'personIds'>> }
  | { type: 'removeSource'; id: ID };

const touch = (tree: Tree): Tree => ({ ...tree, updatedAt: new Date().toISOString() });
const clamp = (value: string, max: number) => value.slice(0, max);

const FIELD_LIMITS: Record<keyof EditablePersonFields, number> = {
  name: LIMITS.name,
  nickname: LIMITS.short,
  born: LIMITS.short,
  died: LIMITS.short,
  place: LIMITS.short,
  notes: LIMITS.notes,
};

export function treeReducer(tree: Tree, action: Action): Tree {
  switch (action.type) {
    case 'load':
      return action.tree;

    case 'applyPlan': {
      if (Object.keys(tree.people).length + action.plan.people.length > LIMITS.maxPeople) return tree;
      const people = { ...tree.people };
      for (const p of action.plan.people) people[p.id] = p;
      return touch({ ...tree, people, edges: [...tree.edges, ...action.plan.edges], counter: action.plan.counter });
    }

    case 'addLoose': {
      if (Object.keys(tree.people).length >= LIMITS.maxPeople || tree.people[action.id]) return tree;
      const counter = tree.counter + 1;
      const person = blankPerson(action.id, `Person ${counter}`);
      return touch({ ...tree, counter, people: { ...tree.people, [person.id]: person } });
    }

    case 'updatePerson': {
      const person = tree.people[action.id];
      if (!person) return tree;
      const next: Person = { ...person, placeholder: false };
      for (const key of Object.keys(action.patch) as (keyof EditablePersonFields)[]) {
        const value = action.patch[key];
        if (typeof value === 'string' && key in FIELD_LIMITS) next[key] = clamp(value, FIELD_LIMITS[key]);
      }
      return touch({ ...tree, people: { ...tree.people, [person.id]: next } });
    }

    case 'setPhoto': {
      const person = tree.people[action.id];
      if (!person) return tree;
      return touch({ ...tree, people: { ...tree.people, [person.id]: { ...person, photoId: action.photoId, placeholder: false } } });
    }

    case 'addFile': {
      const person = tree.people[action.id];
      if (!person || person.files.length >= 200) return tree;
      return touch({ ...tree, people: { ...tree.people, [person.id]: { ...person, files: [...person.files, action.file], placeholder: false } } });
    }

    case 'removeFile': {
      const person = tree.people[action.id];
      if (!person) return tree;
      return touch({ ...tree, people: { ...tree.people, [person.id]: { ...person, files: person.files.filter((f) => f.id !== action.fileId) } } });
    }

    case 'setMe':
      if (action.id !== null && !tree.people[action.id]) return tree;
      return touch({ ...tree, meId: action.id });

    case 'deletePerson': {
      if (!tree.people[action.id] || Object.keys(tree.people).length <= 1) return tree;
      const people = { ...tree.people };
      delete people[action.id];
      return touch({
        ...tree,
        people,
        edges: tree.edges.filter((e) => e.from !== action.id && e.to !== action.id),
        sources: tree.sources.map((s) => ({ ...s, personIds: s.personIds.filter((p) => p !== action.id) })),
        meId: tree.meId === action.id ? null : tree.meId,
      });
    }

    case 'removeEdge':
      // only free-form "other" links can be removed on their own; family structure changes via delete
      return touch({ ...tree, edges: tree.edges.filter((e) => !(e.id === action.id && e.type === 'other')) });

    case 'addSource':
      if (tree.sources.length >= 5000) return tree;
      return touch({ ...tree, sources: [action.source, ...tree.sources] });

    case 'updateSource':
      return touch({
        ...tree,
        sources: tree.sources.map((s) => {
          if (s.id !== action.id) return s;
          const next = { ...s };
          if (typeof action.patch.title === 'string') next.title = clamp(action.patch.title, LIMITS.short);
          if (typeof action.patch.excerpt === 'string') next.excerpt = clamp(action.patch.excerpt, LIMITS.excerpt);
          if (action.patch.personIds) next.personIds = action.patch.personIds.filter((p) => !!tree.people[p]);
          return next;
        }),
      });

    case 'removeSource':
      return touch({ ...tree, sources: tree.sources.filter((s) => s.id !== action.id) });
  }
}

// ---- undo / redo -------------------------------------------------------------------------------------

export interface History {
  present: Tree;
  past: Tree[];
  future: Tree[];
  lastKey: string | null;
  lastAt: number;
}

export type HistoryAction = Action | { type: 'undo' } | { type: 'redo' };

const MAX_UNDO = 30;
const COALESCE_MS = 1500;

export const initHistory = (tree: Tree): History => ({ present: tree, past: [], future: [], lastKey: null, lastAt: 0 });

/** Typing in one field keeps merging into a single undo step. */
function coalesceKey(action: Action): string | null {
  if (action.type === 'updatePerson') return `person:${action.id}:${Object.keys(action.patch).join(',')}`;
  if (action.type === 'updateSource') return `source:${action.id}:${Object.keys(action.patch).join(',')}`;
  return null;
}

export function historyReducer(state: History, action: HistoryAction, now = Date.now()): History {
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    return { present: previous, past: state.past.slice(0, -1), future: [state.present, ...state.future], lastKey: null, lastAt: 0 };
  }
  if (action.type === 'redo') {
    const [next, ...rest] = state.future;
    if (!next) return state;
    return { present: next, past: [...state.past, state.present], future: rest, lastKey: null, lastAt: 0 };
  }
  if (action.type === 'load') return initHistory(action.tree);

  const present = treeReducer(state.present, action);
  if (present === state.present) return state;

  const key = coalesceKey(action);
  if (key && key === state.lastKey && now - state.lastAt < COALESCE_MS) {
    return { ...state, present, lastAt: now, future: [] };
  }
  return { present, past: [...state.past, state.present].slice(-MAX_UNDO), future: [], lastKey: key, lastAt: now };
}
