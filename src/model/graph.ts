import type { Graph, ID, Person } from './types';

export const parentsOf = (g: Graph, id: ID): ID[] =>
  g.edges.filter((e) => e.type === 'parent' && e.to === id).map((e) => e.from);

export const childrenOf = (g: Graph, id: ID): ID[] =>
  g.edges.filter((e) => e.type === 'parent' && e.from === id).map((e) => e.to);

export const partnersOf = (g: Graph, id: ID): ID[] =>
  g.edges
    .filter((e) => e.type === 'partner' && (e.from === id || e.to === id))
    .map((e) => (e.from === id ? e.to : e.from));

export const othersOf = (g: Graph, id: ID): ID[] =>
  g.edges
    .filter((e) => e.type === 'other' && (e.from === id || e.to === id))
    .map((e) => (e.from === id ? e.to : e.from));

/** People who share at least one parent with `id` (includes half-siblings). */
export function siblingsOf(g: Graph, id: ID): ID[] {
  const result = new Set<ID>();
  for (const parent of parentsOf(g, id)) {
    for (const child of childrenOf(g, parent)) {
      if (child !== id) result.add(child);
    }
  }
  return [...result];
}

export const displayName = (p: Person | undefined): string =>
  p && p.name.trim() ? p.name.trim() : 'Unnamed';

export const blankPerson = (id: ID, name: string, placeholder = false): Person => ({
  id,
  name,
  nickname: '',
  born: '',
  died: '',
  place: '',
  notes: '',
  photoId: null,
  placeholder,
  files: [],
});

/** The short date line shown on a person's card. */
export function datesOf(p: Person): string {
  if (p.born && p.died) return `${p.born} – ${p.died}`;
  if (p.born) return `b. ${p.born}`;
  if (p.died) return `d. ${p.died}`;
  return '';
}
