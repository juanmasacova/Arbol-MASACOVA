import { useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { findComponents } from '../layout/layout';
import { displayName } from '../model/graph';
import type { ID } from '../model/types';
import { Icon } from './Icon';

interface Props {
  onOpenPerson: (id: ID) => void;
  onStartTree: () => void;
}

export function PeopleTab({ onOpenPerson, onStartTree }: Props) {
  const { tree } = useStore();
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const treeOf = new Map<ID, number>();
    findComponents({ people: tree.people, edges: tree.edges }).forEach((ids, index) => ids.forEach((id) => treeOf.set(id, index + 1)));
    const q = search.trim().toLowerCase();
    return Object.values(tree.people)
      .filter((p) => !q || `${p.name} ${p.nickname} ${p.place}`.toLowerCase().includes(q))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)))
      .map((p) => ({ person: p, treeNumber: treeOf.get(p.id) ?? 1 }));
  }, [tree.people, tree.edges, search]);

  const treeCount = new Set(rows.map((r) => r.treeNumber)).size;

  return (
    <div className="page">
      <header className="page-head">
        <h1>People</h1>
        <p>Everyone in your notebook, {Object.keys(tree.people).length} so far. Open anyone to jump to them on the tree.</p>
      </header>
      <div className="card">
        <div className="card-head">
          <div className="search-row grow">
            <Icon name="search" size={16} />
            <input className="field field-bare" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, nickname or place" aria-label="Search people" />
          </div>
          <button type="button" className="btn btn-small" onClick={onStartTree}>
            <Icon name="plus" size={16} /> Start another tree
          </button>
        </div>
        <ul className="people-list">
          {rows.map(({ person, treeNumber }) => (
            <li key={person.id}>
              <button type="button" className="people-row" onClick={() => onOpenPerson(person.id)}>
                <span className="people-name">
                  {displayName(person)}
                  {tree.meId === person.id && <span className="badge">me</span>}
                  {person.placeholder && <span className="badge badge-quiet">placeholder</span>}
                </span>
                <span className="muted">{[person.born && person.died ? `${person.born} – ${person.died}` : person.born ? `b. ${person.born}` : '', person.place].filter(Boolean).join(' · ')}</span>
                {treeCount > 1 && <span className="muted">Tree {treeNumber}</span>}
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="hint">No one matches that search.</li>}
        </ul>
      </div>
    </div>
  );
}
