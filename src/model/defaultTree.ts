import { blankPerson } from './graph';
import { newId } from './ids';
import type { Tree } from './types';

/** The starting tree: one blank person, no photo, no information. */
export function defaultTree(): Tree {
  const id = newId('p');
  return {
    version: 1,
    people: { [id]: blankPerson(id, 'Person 1') },
    edges: [],
    sources: [],
    meId: null,
    counter: 1,
    updatedAt: new Date().toISOString(),
  };
}

/** True when the tree is still the untouched starting tree (used before sync decides which copy wins). */
export function isPristine(tree: Tree): boolean {
  const people = Object.values(tree.people);
  if (people.length !== 1 || tree.edges.length > 0 || tree.sources.length > 0) return false;
  const only = people[0];
  return (
    !!only &&
    only.name === 'Person 1' &&
    !only.nickname &&
    !only.born &&
    !only.died &&
    !only.place &&
    !only.notes &&
    !only.photoId &&
    only.files.length === 0
  );
}
