import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isPristine } from '../model/defaultTree';
import type { ID, Tree } from '../model/types';
import { parseTree } from '../security/validate';
import { GithubStore, SyncError, type SyncTarget } from '../storage/github';
import { getToken, loadSyncConfig, clearSyncSettings, saveSyncConfig, setToken, type StoredSyncConfig } from '../storage/secrets';
import { readLocalFile, setRemoteFileLoader } from './files';
import { useStore } from './store';

export type SyncStatus = 'off' | 'connecting' | 'idle' | 'saving' | 'error' | 'conflict' | 'choose';

interface PendingChoice {
  remoteTree: Tree;
  remoteSha: string;
}

interface SyncValue {
  status: SyncStatus;
  message: string | null;
  lastSyncedAt: number | null;
  config: StoredSyncConfig | null;
  pending: PendingChoice | null;
  connect: (target: SyncTarget, token: string, remember: boolean) => Promise<void>;
  disconnect: () => void;
  resolve: (choice: 'remote' | 'local') => Promise<void>;
  retry: () => void;
}

const SyncContext = createContext<SyncValue | null>(null);

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside <SyncProvider>');
  return value;
}

const referencedFileIds = (tree: Tree): Set<ID> => {
  const ids = new Set<ID>();
  for (const p of Object.values(tree.people)) {
    if (p.photoId) ids.add(p.photoId);
    for (const f of p.files) ids.add(f.id);
  }
  return ids;
};

const messageOf = (error: unknown): string =>
  error instanceof SyncError ? error.message : 'Something went wrong while syncing. Your changes are still safe on this device.';

export function SyncProvider({ children }: { children: ReactNode }) {
  const { tree, dispatch, ready } = useStore();
  const [status, setStatus] = useState<SyncStatus>('off');
  const [message, setMessage] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [config, setConfig] = useState<StoredSyncConfig | null>(() => loadSyncConfig());
  const [pending, setPending] = useState<PendingChoice | null>(null);

  const treeRef = useRef(tree);
  treeRef.current = tree;
  const storeRef = useRef<GithubStore | null>(null);
  const shaRef = useRef<string | null>(null);
  const syncedAtRef = useRef<string | null>(null);
  const uploaded = useRef(new Set<ID>());

  const pushAll = useCallback(async (store: GithubStore, snapshot: Tree, sha: string | null) => {
    for (const id of referencedFileIds(snapshot)) {
      if (uploaded.current.has(id)) continue;
      const bytes = await readLocalFile(id);
      if (bytes) {
        await store.pushFile(id, bytes);
        uploaded.current.add(id);
      }
    }
    shaRef.current = await store.pushTree(snapshot, sha);
    syncedAtRef.current = snapshot.updatedAt;
    setLastSyncedAt(Date.now());
    setMessage(null);
    setStatus('idle');
  }, []);

  const attach = useCallback((store: GithubStore) => {
    storeRef.current = store;
    setRemoteFileLoader((id) => store.pullFile(id));
  }, []);

  const connect = useCallback(
    async (target: SyncTarget, token: string, remember: boolean) => {
      setStatus('connecting');
      setMessage(null);
      try {
        const store = new GithubStore(target, token.trim());
        await store.verify(); // throws if the repository is public
        const remote = await store.pullTree();
        saveSyncConfig({ ...target, remember });
        setToken(token.trim(), remember);
        setConfig({ ...target, remember });
        attach(store);
        const local = treeRef.current;
        if (!remote) {
          await pushAll(store, local, null);
          return;
        }
        const remoteTree = parseTree(remote.raw);
        if (isPristine(local)) {
          shaRef.current = remote.sha;
          syncedAtRef.current = remoteTree.updatedAt;
          dispatch({ type: 'load', tree: remoteTree });
          setLastSyncedAt(Date.now());
          setStatus('idle');
        } else if (remoteTree.updatedAt === local.updatedAt) {
          shaRef.current = remote.sha;
          syncedAtRef.current = local.updatedAt;
          setLastSyncedAt(Date.now());
          setStatus('idle');
        } else {
          setPending({ remoteTree, remoteSha: remote.sha });
          setStatus('choose');
        }
      } catch (error) {
        storeRef.current = null;
        setRemoteFileLoader(null);
        setMessage(messageOf(error));
        setStatus('error');
      }
    },
    [attach, dispatch, pushAll],
  );

  // reconnect automatically when this browser remembers the settings and token
  const autoConnected = useRef(false);
  useEffect(() => {
    if (!ready || autoConnected.current) return;
    autoConnected.current = true;
    const saved = loadSyncConfig();
    const token = getToken();
    if (saved && token) void connect({ owner: saved.owner, repo: saved.repo, branch: saved.branch }, token, saved.remember);
  }, [ready, connect]);

  // push local edits shortly after they happen
  useEffect(() => {
    if (status !== 'idle' || !storeRef.current || tree.updatedAt === syncedAtRef.current) return;
    const timer = window.setTimeout(async () => {
      const store = storeRef.current;
      if (!store) return;
      setStatus('saving');
      try {
        await pushAll(store, treeRef.current, shaRef.current);
      } catch (error) {
        if (error instanceof SyncError && error.code === 'CONFLICT') {
          try {
            const remote = await store.pullTree();
            if (remote) {
              setPending({ remoteTree: parseTree(remote.raw), remoteSha: remote.sha });
              setStatus('conflict');
              setMessage(null);
              return;
            }
          } catch (inner) {
            setMessage(messageOf(inner));
            setStatus('error');
            return;
          }
        }
        setMessage(messageOf(error));
        setStatus('error');
      }
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [tree.updatedAt, status, pushAll]);

  // warn before closing the tab with edits that have not reached the private repo yet
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (storeRef.current && (status === 'saving' || (status === 'idle' && treeRef.current.updatedAt !== syncedAtRef.current))) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  const resolve = useCallback(
    async (choice: 'remote' | 'local') => {
      const current = pending;
      const store = storeRef.current;
      if (!current || !store) return;
      setPending(null);
      if (choice === 'remote') {
        shaRef.current = current.remoteSha;
        syncedAtRef.current = current.remoteTree.updatedAt;
        dispatch({ type: 'load', tree: current.remoteTree });
        setLastSyncedAt(Date.now());
        setStatus('idle');
        return;
      }
      setStatus('saving');
      try {
        await pushAll(store, treeRef.current, current.remoteSha);
      } catch (error) {
        setMessage(messageOf(error));
        setStatus('error');
      }
    },
    [pending, dispatch, pushAll],
  );

  const disconnect = useCallback(() => {
    storeRef.current = null;
    shaRef.current = null;
    syncedAtRef.current = null;
    uploaded.current.clear();
    setRemoteFileLoader(null);
    clearSyncSettings();
    setConfig(null);
    setPending(null);
    setMessage(null);
    setStatus('off');
  }, []);

  const retry = useCallback(() => {
    if (storeRef.current) {
      setMessage(null);
      setStatus('idle');
    }
  }, []);

  const value = useMemo<SyncValue>(
    () => ({ status, message, lastSyncedAt, config, pending, connect, disconnect, resolve, retry }),
    [status, message, lastSyncedAt, config, pending, connect, disconnect, resolve, retry],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
