import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { defaultTree } from '../model/defaultTree';
import { historyReducer, initHistory, type History, type HistoryAction } from '../model/reducer';
import type { Tree } from '../model/types';
import { parseTree } from '../security/validate';
import { loadLocalTree, saveLocalTree } from '../storage/local';

interface StoreValue {
  tree: Tree;
  dispatch: (action: HistoryAction) => void;
  canUndo: boolean;
  canRedo: boolean;
  ready: boolean;
  storageError: string | null;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}

const reduce = (state: History, action: HistoryAction): History => historyReducer(state, action);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(reduce, undefined, () => initHistory(defaultTree()));
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const latest = useRef(history.present);
  latest.current = history.present;

  // load whatever this device saved last time
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await loadLocalTree();
        if (raw && !cancelled) dispatch({ type: 'load', tree: parseTree(raw) });
      } catch {
        if (!cancelled) setStorageError('This browser would not open its local storage, so changes may not be saved here. Try a normal (non-private) window.');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // autosave shortly after each change (never before the saved copy has been loaded)
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      saveLocalTree(history.present).catch(() => setStorageError('Could not save on this device. Export a backup from Settings.'));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [history.present, ready]);

  // and immediately when the tab is hidden or closed
  useEffect(() => {
    const flush = () => {
      if (ready) void saveLocalTree(latest.current).catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, [ready]);

  const value = useMemo<StoreValue>(
    () => ({
      tree: history.present,
      dispatch,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      ready,
      storageError,
    }),
    [history.present, history.past.length, history.future.length, ready, storageError],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
