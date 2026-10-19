import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useStore } from '../app/store';
import { useSync } from '../app/sync';
import { defaultTree } from '../model/defaultTree';
import { buildBackup, parseBackup, type ParsedBackup } from '../storage/backup';
import { deleteFile, listFileIds, putFile, wipeLocal } from '../storage/local';
import { Icon } from './Icon';

interface Props {
  onToast: (message: string) => void;
}

const statusText = (status: string): string =>
  ({ off: 'Not connected', connecting: 'Connecting…', idle: 'Up to date', saving: 'Saving…', error: 'Problem', conflict: 'Needs your decision', choose: 'Needs your decision' })[status] ?? status;

export function SettingsTab({ onToast }: Props) {
  const { tree, dispatch } = useStore();
  const sync = useSync();
  const [owner, setOwner] = useState(sync.config?.owner ?? '');
  const [repo, setRepo] = useState(sync.config?.repo ?? '');
  const [branch, setBranch] = useState(sync.config?.branch ?? '');
  const [token, setToken] = useState('');
  const [remember, setRemember] = useState(sync.config?.remember ?? false);
  const [importing, setImporting] = useState<ParsedBackup | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const connected = sync.config !== null && ['idle', 'saving', 'conflict', 'choose'].includes(sync.status);

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    await sync.connect({ owner: owner.trim(), repo: repo.trim(), branch: branch.trim() }, token, remember);
    setToken('');
  };

  const exportBackup = async () => {
    const blob = await buildBackup(tree);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arbol-backup-${new Date().toISOString().slice(0, 10)}.arbol.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const pickImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setImportError(null);
    if (!file) return;
    if (file.size > 200 * 1024 * 1024) return setImportError('That file is too large to be a backup.');
    try {
      setImporting(parseBackup(await file.text()));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read that file.');
    }
  };

  const applyImport = async () => {
    if (!importing) return;
    for (const [id, f] of importing.files) await putFile(id, f.bytes, f.type);
    dispatch({ type: 'load', tree: importing.tree });
    setImporting(null);
    onToast('Backup restored.');
  };

  const cleanUp = async () => {
    const keep = new Set<string>();
    for (const p of Object.values(tree.people)) {
      if (p.photoId) keep.add(p.photoId);
      for (const f of p.files) keep.add(f.id);
    }
    let removed = 0;
    for (const id of await listFileIds()) {
      if (!keep.has(id)) {
        await deleteFile(id);
        removed++;
      }
    }
    onToast(removed ? `Removed ${removed} unused file${removed === 1 ? '' : 's'}. (Undo can no longer bring them back.)` : 'Nothing to clean up.');
  };

  const wipe = async () => {
    sync.disconnect(); // so an emptied device can never overwrite the private repo
    await wipeLocal();
    dispatch({ type: 'load', tree: defaultTree() });
    setConfirmWipe(false);
    onToast('This device has been cleared.');
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <p>Your tree is saved in this browser. To use it on your phone and computer, you can sync it to a private repository that only you can open.</p>
      </header>

      <section className="card">
        <div className="card-head">
          <h2>
            <Icon name="cloud" size={20} /> Sync between devices
          </h2>
          <span className={`status status-${sync.status}`}>{statusText(sync.status)}</span>
        </div>

        {sync.message && (
          <p className="error" role="alert">
            <Icon name="alert" size={16} /> {sync.message}
          </p>
        )}

        {connected ? (
          <>
            <p>
              Syncing with <strong>{sync.config!.owner}/{sync.config!.repo}</strong>
              {sync.lastSyncedAt && <span className="muted"> · last saved {new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
            </p>
            <div className="btn-row">
              <button type="button" className="btn btn-small" onClick={sync.disconnect}>
                Disconnect and forget token
              </button>
            </div>
          </>
        ) : (
          <>
            {sync.status === 'error' && sync.config && (
              <div className="btn-row">
                <button type="button" className="btn btn-small" onClick={sync.retry}>
                  Try again
                </button>
                <button type="button" className="btn btn-small" onClick={sync.disconnect}>
                  Disconnect
                </button>
              </div>
            )}
            <form onSubmit={connect}>
              <div className="grid-2">
                <label className="label">
                  GitHub username
                  <input className="field" value={owner} onChange={(e) => setOwner(e.target.value)} autoComplete="off" required />
                </label>
                <label className="label">
                  Private data repository
                  <input className="field" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="e.g. arbol-data" autoComplete="off" required />
                </label>
              </div>
              <label className="label">
                Access token
                <input className="field" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} placeholder="github_pat_…" required />
              </label>
              <label className="check">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>Remember the token on this device (otherwise you re-enter it each time you open the app)</span>
              </label>
              <details className="branch">
                <summary>Advanced</summary>
                <label className="label">
                  Branch (leave empty for the default)
                  <input className="field" value={branch} onChange={(e) => setBranch(e.target.value)} />
                </label>
              </details>
              <div className="btn-row">
                <button type="submit" className="btn btn-orange" disabled={sync.status === 'connecting'}>
                  <Icon name="lock" size={18} /> {sync.status === 'connecting' ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </form>
            <details className="howto">
              <summary>How do I set this up?</summary>
              <ol>
                <li>
                  On GitHub, create a <strong>new private repository</strong> (for example <code>arbol-data</code>) and tick “Add a README”. Never reuse the public code repository for data.
                </li>
                <li>
                  Go to Settings → Developer settings → Fine-grained tokens → Generate. Choose <strong>Only select repositories</strong> and pick just that private repo. Under Repository permissions set <strong>Contents: Read and write</strong>. Set an expiry (90 days is good).
                </li>
                <li>Paste the token above and press Connect. Do the same on your phone, using the same repository name.</li>
              </ol>
              <p className="hint">The app refuses to connect to a public repository, and only ever talks to api.github.com.</p>
            </details>
          </>
        )}
      </section>

      <section className="card">
        <h2>
          <Icon name="download" size={20} /> Backup
        </h2>
        <p>Download everything (tree, notes and attached files) as one file you can keep somewhere safe, or restore from one.</p>
        <div className="btn-row">
          <button type="button" className="btn btn-small" onClick={exportBackup}>
            <Icon name="download" size={16} /> Download backup
          </button>
          <label className="btn btn-small file-btn">
            <Icon name="upload" size={16} /> Restore from backup
            <input type="file" accept=".json,application/json" onChange={pickImport} />
          </label>
          <button type="button" className="btn btn-small" onClick={cleanUp}>
            Clean up unused files
          </button>
        </div>
        {importError && <p className="error" role="alert">{importError}</p>}
        {importing && (
          <div className="confirm" role="alertdialog" aria-label="Confirm restore">
            <p>
              This backup has {Object.keys(importing.tree.people).length} people. Restoring <strong>replaces what is on this device now</strong>
              {sync.status !== 'off' && ' — and because sync is on, it will replace your private repository copy too'}.
            </p>
            <div className="btn-row">
              <button type="button" className="btn btn-small" onClick={() => setImporting(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-small btn-danger" onClick={applyImport}>
                Replace with backup
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>
          <Icon name="lock" size={20} /> Privacy
        </h2>
        <ul className="plain">
          <li>The code for this site is public. Your family information is not part of it.</li>
          <li>Your tree lives in this browser, and in your private repository only if you connect one.</li>
          <li>No analytics, no ads, no third-party scripts. Links you save are only opened when you click them.</li>
        </ul>
        {!confirmWipe ? (
          <button type="button" className="link-btn danger-btn" onClick={() => setConfirmWipe(true)}>
            <Icon name="trash" size={16} /> Delete all data on this device
          </button>
        ) : (
          <div className="confirm" role="alertdialog" aria-label="Confirm clear device">
            <p>This removes the tree, files and sync settings from this browser. Your private repository copy, if any, is not touched. Download a backup first if unsure.</p>
            <div className="btn-row">
              <button type="button" className="btn btn-small" onClick={() => setConfirmWipe(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-small btn-danger" onClick={wipe}>
                Delete everything here
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
