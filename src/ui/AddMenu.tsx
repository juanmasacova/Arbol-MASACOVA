import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { displayName } from '../model/graph';
import type { ID, Person } from '../model/types';
import { RELATION_OPTIONS, type AddInput, type PlanResult, type RelationGroup, type RelationKind } from '../relations/relations';
import type { Anchor } from './Canvas';
import { Icon } from './Icon';

interface Props {
  person: Person;
  people: Record<ID, Person>;
  anchor: Anchor | null;
  onPlan: (input: AddInput) => PlanResult;
  onClose: () => void;
}

type Stage =
  | { type: 'main' }
  | { type: 'choice'; kind: RelationKind; choices: Record<number, ID>; step: number; question: string; candidates: ID[] }
  | { type: 'other' };

const MENU_W = 350;
const MENU_H = 540; // typical height; the menu scrolls inside the screen if it is ever taller
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Put the menu beside the person (right, else left), never on top of them, and always on screen. */
function placeMenu(anchor: Anchor): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const h = Math.min(MENU_H, vh - 16);
  const r = anchor.rect;
  if (!r) return { x: clamp(anchor.x - MENU_W / 2, 8, vw - MENU_W - 8), y: clamp(anchor.y, 8, vh - h - 8) };
  let x = r.right + 14;
  if (x + MENU_W > vw - 8) x = r.left - MENU_W - 14;
  if (x < 8) return { x: clamp(anchor.x - MENU_W / 2, 8, vw - MENU_W - 8), y: clamp(r.bottom + 8, 8, vh - h - 8) };
  return { x, y: clamp((r.top + r.bottom) / 2 - h / 2, 8, vh - h - 8) };
}

const GROUPS: RelationGroup[] = ['Close family', 'Ancestors', 'Extended family', 'Descendants', 'Anyone else'];
const SUGGESTIONS = ['Godparent', 'Family friend', 'Step-parent', 'Step-sibling', 'Adoptive parent', 'Guardian', 'In-law', 'Neighbour'];

export function AddMenu({ person, people, anchor, onPlan, onClose }: Props) {
  const [stage, setStage] = useState<Stage>({ type: 'main' });
  const [label, setLabel] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('button, input')?.focus();
  }, [stage.type]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const grouped = useMemo(() => GROUPS.map((g) => ({ group: g, options: RELATION_OPTIONS.filter((o) => o.group === g) })), []);

  const run = (kind: RelationKind, choices: Record<number, ID> = {}, otherLabel?: string) => {
    const result = onPlan({ kind, choices, label: otherLabel });
    if (result.status === 'choice') {
      setStage({ type: 'choice', kind, choices, step: result.step, question: result.question, candidates: result.candidates });
    }
  };

  const submitOther = (e: FormEvent) => {
    e.preventDefault();
    run('other', {}, label);
  };

  const spot = anchor ? placeMenu(anchor) : null;
  const style: CSSProperties | undefined = spot ? ({ '--mx': `${spot.x}px`, '--my': `${spot.y}px` } as CSSProperties) : undefined;

  return (
    <>
      <div className="menu-backdrop" onPointerDown={onClose} aria-hidden="true" />
      <div ref={rootRef} className={`add-menu${anchor ? '' : ' is-centered'}`} style={style} role="dialog" aria-label={`Add a relative to ${displayName(person)}`}>
        <div className="add-menu-head">
          <h2>
            Add a relative to <span>{displayName(person)}</span>
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>

        {stage.type === 'main' && (
          <div className="add-menu-body">
            {grouped.map(({ group, options }) => (
              <section key={group}>
                <h3>{group}</h3>
                <div className="chip-row">
                  {options.map((o) => (
                    <button
                      key={o.kind}
                      type="button"
                      className={`chip${o.kind === 'other' ? ' chip-other' : ''}`}
                      onClick={() => (o.kind === 'other' ? setStage({ type: 'other' }) : run(o.kind))}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <p className="hint">Missing in-between relatives (like a parent for a cousin) are added as dashed “Unknown” placeholders you can fill in later.</p>
          </div>
        )}

        {stage.type === 'choice' && (
          <div className="add-menu-body">
            <h3>{stage.question}</h3>
            <div className="choice-list">
              {stage.candidates.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="chip chip-wide"
                  onClick={() => run(stage.kind, { ...stage.choices, [stage.step]: id })}
                >
                  {displayName(people[id])}
                </button>
              ))}
            </div>
            <button type="button" className="link-btn" onClick={() => setStage({ type: 'main' })}>
              ← Back
            </button>
          </div>
        )}

        {stage.type === 'other' && (
          <form className="add-menu-body" onSubmit={submitOther}>
            <h3>How are they connected?</h3>
            <input
              className="field"
              list="relation-suggestions"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Godmother, family friend…"
              aria-label="Type of connection"
            />
            <datalist id="relation-suggestions">
              {SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p className="hint">They appear beside {displayName(person)} joined by a dashed orange line with this label.</p>
            <div className="btn-row">
              <button type="button" className="link-btn" onClick={() => setStage({ type: 'main' })}>
                ← Back
              </button>
              <button type="submit" className="btn btn-orange">
                Add person
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
