import { useMemo, useState, type FormEvent } from 'react';
import { useStore } from '../app/store';
import { displayName } from '../model/graph';
import { newId } from '../model/ids';
import type { ID, Source } from '../model/types';
import { hostOf, safeUrl } from '../security/safeUrl';
import { Icon } from './Icon';

interface Props {
  onOpenPerson: (id: ID) => void;
  onToast: (message: string) => void;
}

export function SourcesTab({ onOpenPerson, onToast }: Props) {
  const { tree, dispatch } = useStore();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [picked, setPicked] = useState<Set<ID>>(new Set());
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ID | ''>('');

  const people = useMemo(
    () => Object.values(tree.people).sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [tree.people],
  );
  const shown = people.filter((p) => displayName(p).toLowerCase().includes(search.trim().toLowerCase()));
  const sources = tree.sources.filter((s) => !filter || s.personIds.includes(filter));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = safeUrl(url);
    if (!clean) {
      setError('Enter a web address that starts with http:// or https:// (or just a domain like example.com/page).');
      return;
    }
    dispatch({
      type: 'addSource',
      source: {
        id: newId('s'),
        url: clean,
        title: title.trim().slice(0, 160),
        excerpt: excerpt.trim().slice(0, 8000),
        personIds: [...picked],
        addedAt: new Date().toISOString(),
      },
    });
    setUrl('');
    setTitle('');
    setExcerpt('');
    setPicked(new Set());
    setError(null);
    onToast('Source saved.');
  };

  const addToNotes = (source: Source, personId: ID) => {
    const person = tree.people[personId];
    if (!person) return;
    const label = source.title || hostOf(source.url);
    const entry = `— ${label} (${source.url})${source.excerpt ? `\n${source.excerpt}` : ''}`;
    dispatch({ type: 'updatePerson', id: personId, patch: { notes: person.notes ? `${person.notes}\n\n${entry}` : entry } });
    onToast(`Added to ${displayName(person)}’s notes.`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Sources</h1>
        <p>
          Save links to records, articles and family pages, and choose who each one is about. Árbol never opens these links for you: you read the page, then paste the
          bits worth keeping into the excerpt and send them to a person’s notes.
        </p>
      </header>

      <form className="card" onSubmit={submit}>
        <h2>Add a source</h2>
        <div className="grid-2">
          <label className="label">
            Link
            <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
          </label>
          <label className="label">
            Title
            <input className="field" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 1940 census page" />
          </label>
        </div>
        <label className="label">
          Excerpt <span className="muted">(optional — text you copied from the page)</span>
          <textarea className="field" rows={3} maxLength={8000} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} />
        </label>
        <fieldset className="people-picker">
          <legend>Who is this about?</legend>
          <div className="search-row">
            <Icon name="search" size={16} />
            <input className="field field-bare" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" />
          </div>
          <div className="check-list">
            {shown.map((p) => (
              <label key={p.id} className="check">
                <input
                  type="checkbox"
                  checked={picked.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setPicked(next);
                  }}
                />
                <span>{displayName(p)}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="hint">No one matches.</p>}
          </div>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="btn-row">
          <button type="submit" className="btn btn-orange">
            <Icon name="plus" size={18} /> Save source
          </button>
        </div>
      </form>

      <section className="card">
        <div className="card-head">
          <h2>Saved sources ({sources.length})</h2>
          <label className="label label-inline">
            Show
            <select className="field" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {displayName(p)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {sources.length === 0 && <p className="hint">Nothing here yet.</p>}
        <ul className="source-list">
          {sources.map((s) => {
            const href = safeUrl(s.url);
            const tagged = s.personIds.filter((id) => tree.people[id]);
            const untagged = people.filter((p) => !s.personIds.includes(p.id));
            return (
              <li key={s.id} className="source">
                <div className="source-head">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {s.title || hostOf(href)} <Icon name="external" size={14} />
                    </a>
                  ) : (
                    <span>{s.title || s.url}</span>
                  )}
                  <span className="muted">{hostOf(s.url)}</span>
                  <button type="button" className="icon-btn icon-btn-small" aria-label={`Delete source ${s.title || hostOf(s.url)}`} onClick={() => dispatch({ type: 'removeSource', id: s.id })}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                <textarea
                  className="field"
                  rows={2}
                  maxLength={8000}
                  value={s.excerpt}
                  placeholder="Excerpt or your own comments…"
                  aria-label="Excerpt"
                  onChange={(e) => dispatch({ type: 'updateSource', id: s.id, patch: { excerpt: e.target.value } })}
                />
                <div className="chip-row">
                  {tagged.map((id) => (
                    <span key={id} className="tag">
                      <button type="button" className="tag-name" onClick={() => onOpenPerson(id)}>
                        {displayName(tree.people[id])}
                      </button>
                      <button type="button" className="tag-x" aria-label={`Remove ${displayName(tree.people[id])} from this source`} onClick={() => dispatch({ type: 'updateSource', id: s.id, patch: { personIds: s.personIds.filter((p) => p !== id) } })}>
                        ×
                      </button>
                    </span>
                  ))}
                  {untagged.length > 0 && (
                    <select
                      className="field field-small"
                      value=""
                      aria-label="Tag a person"
                      onChange={(e) => e.target.value && dispatch({ type: 'updateSource', id: s.id, patch: { personIds: [...s.personIds, e.target.value] } })}
                    >
                      <option value="">+ tag a person</option>
                      {untagged.map((p) => (
                        <option key={p.id} value={p.id}>
                          {displayName(p)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {tagged.length > 0 && (
                  <div className="chip-row">
                    <span className="muted">Send to notes of:</span>
                    {tagged.map((id) => (
                      <button key={id} type="button" className="chip chip-small" onClick={() => addToNotes(s, id)}>
                        {displayName(tree.people[id])}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
