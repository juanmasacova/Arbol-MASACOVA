import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { layoutAll } from '../layout/layout';
import { displayName } from '../model/graph';
import { newId } from '../model/ids';
import type { ID } from '../model/types';
import { planAdd, type AddInput, type PlanResult } from '../relations/relations';
import { AddMenu } from '../ui/AddMenu';
import { Canvas, type Anchor, type CenterRequest } from '../ui/Canvas';
import { SyncDecision, Toast } from '../ui/Dialogs';
import { Icon } from '../ui/Icon';
import { PeopleTab } from '../ui/PeopleTab';
import { PersonPanel } from '../ui/PersonPanel';
import { SettingsTab } from '../ui/SettingsTab';
import { Sidebar, type Tab } from '../ui/Sidebar';
import { SourcesTab } from '../ui/SourcesTab';
import { useMedia } from '../ui/useMedia';
import { useStore } from './store';

const HINT_KEY = 'arbol.hint.dismissed';
const PANEL_WIDTH = 400;

const readHintDismissed = () => {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
};

export default function App() {
  const { tree, dispatch, canUndo, canRedo, ready, storageError } = useStore();
  const [tab, setTab] = useState<Tab>('tree');
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [focusTreeId, setFocusTreeId] = useState<ID | null>(null);
  const [viewAll, setViewAll] = useState(false);
  const [menu, setMenu] = useState<{ personId: ID; anchor: Anchor | null } | null>(null);
  const [centerReq, setCenterReq] = useState<CenterRequest>({ n: 0, target: 'fit' });
  const [focusName, setFocusName] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState(readHintDismissed);
  const compact = useMedia('(max-width: 800px)');

  const requestCenter = useCallback((target: ID | 'fit') => setCenterReq((r) => ({ n: r.n + 1, target })), []);

  // layout depends only on who exists and how they connect, not on names or notes
  const structureKey = useMemo(
    () => `${Object.keys(tree.people).join(',')}|${tree.edges.map((e) => `${e.type}${e.from}${e.to}`).join(',')}|${tree.meId ?? ''}`,
    [tree.people, tree.edges, tree.meId],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layouts = useMemo(() => layoutAll({ people: tree.people, edges: tree.edges }, tree.meId), [structureKey]);

  const treeNames = useMemo(
    () =>
      layouts.map((l, i) => {
        const base = tree.meId && l.ids.includes(tree.meId) ? 'My tree' : `Tree ${i + 1}`;
        return `${base} · ${displayName(tree.people[l.rootId])}`;
      }),
    [layouts, tree.meId, tree.people],
  );
  const focusIndex = Math.max(0, layouts.findIndex((l) => focusTreeId !== null && l.ids.includes(focusTreeId)));
  const visibleLayouts = viewAll ? layouts : layouts.slice(focusIndex, focusIndex + 1);
  const visibleNames = viewAll ? treeNames : treeNames.slice(focusIndex, focusIndex + 1);

  const selected = selectedId ? tree.people[selectedId] : undefined;
  const menuPerson = menu ? tree.people[menu.personId] : undefined;

  // first load: show the saved tree (around "me" if set)
  useEffect(() => {
    if (ready) requestCenter(tree.meId ?? 'fit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // marking someone as "me" rebuilds the view around them
  const lastMe = useRef(tree.meId);
  useEffect(() => {
    if (tree.meId && tree.meId !== lastMe.current) {
      setViewAll(false);
      setFocusTreeId(tree.meId);
      requestCenter(tree.meId);
    }
    lastMe.current = tree.meId;
  }, [tree.meId, requestCenter]);

  // forget selections that no longer exist (deleted, or replaced by a synced copy)
  useEffect(() => {
    if (selectedId && !tree.people[selectedId]) setSelectedId(null);
    if (menu && !tree.people[menu.personId]) setMenu(null);
  }, [tree.people, selectedId, menu]);

  const select = useCallback((id: ID | null) => {
    setSelectedId(id);
    if (id) setFocusTreeId(id);
  }, []);

  const goToPerson = useCallback(
    (id: ID) => {
      setTab('tree');
      setViewAll(false);
      select(id);
      requestCenter(id);
    },
    [select, requestCenter],
  );

  const openMenu = useCallback((personId: ID, anchor: Anchor | null) => setMenu({ personId, anchor }), []);

  const handlePlan = (input: AddInput): PlanResult => {
    const result = menu ? planAdd(tree, menu.personId, input) : ({ status: 'error', message: 'No one is selected.' } as PlanResult);
    if (result.status === 'ok') {
      dispatch({ type: 'applyPlan', plan: result });
      setMenu(null);
      setViewAll(false);
      setSelectedId(result.focusId);
      setFocusTreeId(result.focusId);
      setFocusName((n) => n + 1);
      requestCenter(result.focusId);
    } else if (result.status === 'error') {
      setToast(result.message);
      setMenu(null);
    }
    return result;
  };

  /** A new person with no connections: becomes the start of a separate tree. */
  const startTree = () => {
    const id = newId('p');
    dispatch({ type: 'addLoose', id });
    setTab('tree');
    setViewAll(false);
    select(id);
    setFocusName((n) => n + 1);
    requestCenter(id);
  };

  // keyboard: undo / redo / escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        } else if (key === 'y') {
          e.preventDefault();
          dispatch({ type: 'redo' });
        }
      } else if (e.key === 'Escape' && !menu && !typing) {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, menu]);

  const dismissHint = () => {
    setHintDismissed(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* ignore */
    }
  };

  const panelOpen = tab === 'tree' && !!selected;
  const insetRight = panelOpen && !compact ? PANEL_WIDTH : 0;
  const insetBottom = panelOpen && compact ? Math.round(window.innerHeight * 0.62) : 0;
  const showHint = tab === 'tree' && !hintDismissed && Object.keys(tree.people).length <= 1;

  return (
    <div className="app">
      <Sidebar tab={tab} onTab={setTab} />
      <main className="stage">
        {storageError && (
          <div className="banner" role="alert">
            <Icon name="alert" size={18} /> {storageError}
          </div>
        )}

        {tab === 'tree' && (
          <section className={`tree-view${panelOpen && !compact ? ' has-panel' : ''}`} aria-label="Family tree">
            <Canvas
              layouts={visibleLayouts}
              showAll={viewAll}
              treeLabels={visibleNames}
              people={tree.people}
              meId={tree.meId}
              selectedId={selectedId}
              menuOpen={!!menu}
              insetRight={insetRight}
              insetBottom={insetBottom}
              centerReq={centerReq}
              onSelect={select}
              onOpenMenu={openMenu}
            />

            {layouts.length > 1 && (
              <div className="tree-chips" role="tablist" aria-label="Trees">
                {layouts.map((l, i) => (
                  <button
                    key={l.rootId}
                    type="button"
                    role="tab"
                    aria-selected={!viewAll && i === focusIndex}
                    className={`chip${!viewAll && i === focusIndex ? ' is-on' : ''}`}
                    onClick={() => {
                      setViewAll(false);
                      setFocusTreeId(l.rootId);
                      requestCenter(l.rootId);
                    }}
                  >
                    {treeNames[i]}
                  </button>
                ))}
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewAll}
                  className={`chip${viewAll ? ' is-on' : ''}`}
                  onClick={() => {
                    setViewAll(true);
                    requestCenter('fit');
                  }}
                >
                  All trees
                </button>
              </div>
            )}

            <div className="controls" role="toolbar" aria-label="Tree tools">
              <button type="button" className="icon-btn" onClick={() => dispatch({ type: 'undo' })} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
                <Icon name="undo" />
              </button>
              <button type="button" className="icon-btn" onClick={() => dispatch({ type: 'redo' })} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
                <Icon name="redo" />
              </button>
              <button type="button" className="icon-btn" onClick={() => requestCenter('fit')} aria-label="Fit everything on screen" title="Fit to screen">
                <Icon name="fit" />
              </button>
              {tree.meId && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    setViewAll(false);
                    setFocusTreeId(tree.meId);
                    requestCenter(tree.meId!);
                  }}
                  aria-label="Centre on me"
                  title="Centre on me"
                >
                  <Icon name="me" />
                </button>
              )}
              <button type="button" className="icon-btn" onClick={startTree} aria-label="Start another tree" title="Start another, separate tree">
                <Icon name="plus" />
              </button>
            </div>

            {showHint && (
              <div className="hint-card" role="note">
                <p>
                  <strong>Welcome.</strong> This is Person 1. <strong>Hover over the card for 3 seconds</strong> (or press and hold on a phone) to add a relative. Click the card to write notes.
                </p>
                <button type="button" className="btn btn-small" onClick={dismissHint}>
                  Got it
                </button>
              </div>
            )}

            {panelOpen && selected && (
              <PersonPanel
                key={`panel-${selected.id}`}
                person={selected}
                focusNameSignal={focusName}
                onClose={() => setSelectedId(null)}
                onSelect={goToPerson}
                onAddRelative={(id) => openMenu(id, null)}
                onToast={setToast}
              />
            )}

            {menu && menuPerson && <AddMenu key={`menu-${menu.personId}`} person={menuPerson} people={tree.people} anchor={menu.anchor} onPlan={handlePlan} onClose={() => setMenu(null)} />}
          </section>
        )}

        {tab === 'sources' && <SourcesTab onOpenPerson={goToPerson} onToast={setToast} />}
        {tab === 'people' && <PeopleTab onOpenPerson={goToPerson} onStartTree={startTree} />}
        {tab === 'settings' && <SettingsTab onToast={setToast} />}
      </main>

      <SyncDecision />
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  );
}
