import { useEffect } from 'react';
import { useStore } from '../app/store';
import { useSync } from '../app/sync';

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDone, 4500);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);
  return (
    <div className="toast-region" aria-live="polite">
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  );
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown time' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

/** Shown when this device and the private repository disagree, so nothing is overwritten silently. */
export function SyncDecision() {
  const sync = useSync();
  const { tree } = useStore();
  const { pending } = sync;
  if (!pending || (sync.status !== 'choose' && sync.status !== 'conflict')) return null;
  const remotePeople = Object.keys(pending.remoteTree.people).length;
  const localPeople = Object.keys(tree.people).length;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="sync-title">
        <h2 id="sync-title">{sync.status === 'conflict' ? 'Your tree changed on another device' : 'Two versions of your tree'}</h2>
        <p>Nothing has been overwritten yet. Choose which copy to keep.</p>
        <div className="compare">
          <div>
            <h3>Private repository</h3>
            <p>{remotePeople} {remotePeople === 1 ? 'person' : 'people'}</p>
            <p className="muted">saved {when(pending.remoteTree.updatedAt)}</p>
          </div>
          <div>
            <h3>This device</h3>
            <p>{localPeople} {localPeople === 1 ? 'person' : 'people'}</p>
            <p className="muted">edited {when(tree.updatedAt)}</p>
          </div>
        </div>
        <div className="btn-col">
          <button type="button" className="btn btn-orange" onClick={() => void sync.resolve('remote')}>
            Use the repository copy
          </button>
          <button type="button" className="btn" onClick={() => void sync.resolve('local')}>
            Replace the repository with this device
          </button>
          <button type="button" className="link-btn" onClick={sync.disconnect}>
            Cancel and disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
