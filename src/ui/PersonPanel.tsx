import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { downloadDocument, storeUpload } from '../app/files';
import { useStore } from '../app/store';
import { componentsWithout, findComponents } from '../layout/layout';
import { childrenOf, displayName, othersOf, parentsOf, partnersOf, siblingsOf } from '../model/graph';
import { newId } from '../model/ids';
import type { Edge, ID, Person } from '../model/types';
import { ACCEPT_ATTR, PHOTO_ACCEPT_ATTR } from '../security/files';
import { hostOf, safeUrl } from '../security/safeUrl';
import { Icon } from './Icon';
import { useImage } from './useImage';

interface Props {
  person: Person;
  focusNameSignal: number;
  onClose: () => void;
  onSelect: (id: ID) => void;
  onAddRelative: (id: ID) => void;
  onToast: (message: string) => void;
}

const kb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function PersonPanel({ person, focusNameSignal, onClose, onSelect, onAddRelative, onToast }: Props) {
  const { tree, dispatch } = useStore();
  const nameRef = useRef<HTMLInputElement>(null);
  const photo = useImage(person.photoId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const isMe = tree.meId === person.id;

  useEffect(() => {
    if (focusNameSignal > 0) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [focusNameSignal, person.id]);

  useEffect(() => {
    setConfirmDelete(false);
    setLinkUrl('');
    setLinkTitle('');
    setLinkError(null);
  }, [person.id]);

  const edit = (patch: Partial<Pick<Person, 'name' | 'nickname' | 'born' | 'died' | 'place' | 'notes'>>) =>
    dispatch({ type: 'updatePerson', id: person.id, patch });

  const relations = useMemo(() => {
    const g = { people: tree.people, edges: tree.edges };
    const others = tree.edges.filter((e): e is Edge => e.type === 'other' && (e.from === person.id || e.to === person.id));
    return {
      parents: parentsOf(g, person.id),
      partners: partnersOf(g, person.id),
      children: childrenOf(g, person.id),
      siblings: siblingsOf(g, person.id),
      others: others.map((e) => ({ edge: e, other: e.from === person.id ? e.to : e.from })),
      otherCount: othersOf(g, person.id).length,
    };
  }, [tree.people, tree.edges, person.id]);

  const mySources = tree.sources.filter((s) => s.personIds.includes(person.id));

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const result = await storeUpload(file, 'photo');
    if ('error' in result) return onToast(result.error);
    dispatch({ type: 'setPhoto', id: person.id, photoId: result.item.id });
  };

  const onDocument = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const result = await storeUpload(file, 'document');
    if ('error' in result) return onToast(result.error);
    dispatch({ type: 'addFile', id: person.id, file: result.item });
  };

  const addLink = (e: FormEvent) => {
    e.preventDefault();
    const url = safeUrl(linkUrl);
    if (!url) {
      setLinkError('Enter a web address, like https://example.com/page');
      return;
    }
    dispatch({
      type: 'addSource',
      source: { id: newId('s'), url, title: linkTitle.trim().slice(0, 160), excerpt: '', personIds: [person.id], addedAt: new Date().toISOString() },
    });
    setLinkUrl('');
    setLinkTitle('');
    setLinkError(null);
  };

  const remove = () => {
    // file blobs are kept so Undo works; Settings → “Clean up unused files” removes them for good
    dispatch({ type: 'deletePerson', id: person.id });
    onClose();
  };

  const deletePreview = useMemo(() => {
    const g = { people: tree.people, edges: tree.edges };
    const before = findComponents(g).length;
    const after = componentsWithout(g, person.id);
    const connections = tree.edges.filter((e) => e.from === person.id || e.to === person.id).length;
    return { split: Math.max(0, after - before), connections };
  }, [tree.people, tree.edges, person.id]);

  const relRow = (title: string, ids: ID[]) =>
    ids.length > 0 && (
      <div className="rel-row">
        <span className="rel-title">{title}</span>
        <span className="rel-people">
          {ids.map((id) => (
            <button key={id} type="button" className="chip chip-small" onClick={() => onSelect(id)}>
              {displayName(tree.people[id])}
            </button>
          ))}
        </span>
      </div>
    );

  return (
    <aside className="panel" aria-label={`Details for ${displayName(person)}`}>
      <div className="panel-head">
        <label className="photo-pick" title="Choose a photo">
          {photo ? <img src={photo} alt="" /> : <Icon name="camera" size={26} />}
          <input type="file" accept={PHOTO_ACCEPT_ATTR} onChange={onPhoto} aria-label="Choose a photo" />
        </label>
        <div className="panel-title">
          <input
            ref={nameRef}
            className="field field-title"
            value={person.name}
            maxLength={120}
            onChange={(e) => edit({ name: e.target.value })}
            placeholder="Name"
            aria-label="Name"
          />
          {person.photoId && (
            <button
              type="button"
              className="link-btn"
              onClick={() => dispatch({ type: 'setPhoto', id: person.id, photoId: null })}
            >
              Remove photo
            </button>
          )}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
          <Icon name="close" />
        </button>
      </div>

      <div className="panel-body">
        <div className="btn-row">
          <button type="button" className="btn btn-orange" onClick={() => onAddRelative(person.id)}>
            <Icon name="plus" size={18} /> Add relative
          </button>
          <button
            type="button"
            className={`btn${isMe ? ' btn-on' : ''}`}
            aria-pressed={isMe}
            onClick={() => dispatch({ type: 'setMe', id: isMe ? null : person.id })}
          >
            <Icon name="me" size={18} /> {isMe ? 'This is me' : 'Mark as me'}
          </button>
        </div>

        {person.placeholder && <p className="hint">This is a placeholder added to keep the tree connected. Give it a name when you learn who it is.</p>}

        <div className="grid-2">
          <label className="label">
            Born
            <input className="field" value={person.born} maxLength={160} onChange={(e) => edit({ born: e.target.value })} placeholder="e.g. 1931 or c. 1890" />
          </label>
          <label className="label">
            Died
            <input className="field" value={person.died} maxLength={160} onChange={(e) => edit({ died: e.target.value })} placeholder="optional" />
          </label>
        </div>
        <div className="grid-2">
          <label className="label">
            Also known as
            <input className="field" value={person.nickname} maxLength={160} onChange={(e) => edit({ nickname: e.target.value })} placeholder="nickname, maiden name…" />
          </label>
          <label className="label">
            Place
            <input className="field" value={person.place} maxLength={160} onChange={(e) => edit({ place: e.target.value })} placeholder="town, region, country" />
          </label>
        </div>

        <label className="label">
          Notes
          <textarea
            className="field field-notes"
            value={person.notes}
            maxLength={20000}
            rows={9}
            onChange={(e) => edit({ notes: e.target.value })}
            placeholder="Stories, facts, where you found them, questions to ask relatives…"
          />
        </label>

        <section className="section">
          <h3>Links &amp; sources</h3>
          {mySources.length === 0 && <p className="hint">No links yet. Add pages, records or articles that mention {displayName(person)}.</p>}
          <ul className="item-list">
            {mySources.map((s) => {
              const href = safeUrl(s.url);
              const label = s.title || hostOf(s.url) || s.url;
              return (
                <li key={s.id}>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {label} <span className="muted">· {hostOf(href)}</span> <Icon name="external" size={14} />
                    </a>
                  ) : (
                    <span>{label}</span>
                  )}
                  <button
                    type="button"
                    className="icon-btn icon-btn-small"
                    aria-label={`Remove link ${label} from ${displayName(person)}`}
                    onClick={() => dispatch({ type: 'updateSource', id: s.id, patch: { personIds: s.personIds.filter((p) => p !== person.id) } })}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
          <form className="inline-form" onSubmit={addLink}>
            <input className="field" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" aria-label="Link address" inputMode="url" />
            <input className="field" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="What is it? (optional)" aria-label="Link title" maxLength={160} />
            <button type="submit" className="btn btn-small">
              Add link
            </button>
          </form>
          {linkError && <p className="error" role="alert">{linkError}</p>}
        </section>

        <section className="section">
          <h3>Files</h3>
          {person.files.length === 0 && <p className="hint">Attach scans, certificates or letters (images, PDF, text or Office files up to 10 MB).</p>}
          <ul className="item-list">
            {person.files.map((f) => (
              <li key={f.id}>
                <span>
                  <Icon name="file" size={16} /> {f.name} <span className="muted">· {kb(f.size)}</span>
                </span>
                <span className="item-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn-small"
                    aria-label={`Download ${f.name}`}
                    onClick={async () => (await downloadDocument(f)) || onToast('That file is not available on this device yet.')}
                  >
                    <Icon name="download" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-small"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => dispatch({ type: 'removeFile', id: person.id, fileId: f.id })}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <label className="btn btn-small file-btn">
            <Icon name="upload" size={16} /> Attach a file
            <input type="file" accept={ACCEPT_ATTR} onChange={onDocument} />
          </label>
        </section>

        <section className="section">
          <h3>Connections</h3>
          {relations.parents.length + relations.partners.length + relations.children.length + relations.siblings.length + relations.others.length === 0 && (
            <p className="hint">Not connected to anyone yet. Hover over their card for three seconds (or press “Add relative”).</p>
          )}
          {relRow('Parents', relations.parents)}
          {relRow('Partners', relations.partners)}
          {relRow('Siblings', relations.siblings)}
          {relRow('Children', relations.children)}
          {relations.others.map(({ edge, other }) => (
            <div className="rel-row" key={edge.id}>
              <span className="rel-title">{edge.label || 'Connection'}</span>
              <span className="rel-people">
                <button type="button" className="chip chip-small" onClick={() => onSelect(other)}>
                  {displayName(tree.people[other])}
                </button>
                <button type="button" className="icon-btn icon-btn-small" aria-label={`Remove this connection to ${displayName(tree.people[other])}`} onClick={() => dispatch({ type: 'removeEdge', id: edge.id })}>
                  <Icon name="close" size={16} />
                </button>
              </span>
            </div>
          ))}
        </section>

        <section className="section danger">
          {!confirmDelete ? (
            <button type="button" className="link-btn danger-btn" onClick={() => setConfirmDelete(true)} disabled={Object.keys(tree.people).length <= 1}>
              <Icon name="trash" size={16} /> Delete this person
            </button>
          ) : (
            <div className="confirm" role="alertdialog" aria-label="Confirm delete">
              <p>
                Delete <strong>{displayName(person)}</strong>, their notes and files, and {deletePreview.connections} connection{deletePreview.connections === 1 ? '' : 's'}?
                {deletePreview.split > 0 && ` This will split the tree into ${deletePreview.split + 1} separate trees.`} You can undo right after with Ctrl/⌘+Z.
              </p>
              <div className="btn-row">
                <button type="button" className="btn btn-small" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
                <button type="button" className="btn btn-small btn-danger" onClick={remove}>
                  Delete
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
