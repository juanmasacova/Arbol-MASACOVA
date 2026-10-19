import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Person, ID } from '../model/types';
import type { TreeLayout } from '../layout/layout';
import { hashString, sketchify } from '../layout/sketch';
import { PersonNode } from './PersonNode';

interface View {
  x: number;
  y: number;
  k: number;
}

export interface CenterRequest {
  n: number;
  target: ID | 'fit';
}

export interface Anchor {
  x: number;
  y: number;
  /** Screen rectangle of the person the menu belongs to, so the menu can sit beside it instead of on top. */
  rect?: { left: number; right: number; top: number; bottom: number };
}

interface Props {
  layouts: TreeLayout[];
  showAll: boolean;
  treeLabels: string[];
  people: Record<ID, Person>;
  meId: ID | null;
  selectedId: ID | null;
  menuOpen: boolean;
  insetRight: number;
  insetBottom: number;
  centerReq: CenterRequest;
  onSelect: (id: ID | null) => void;
  onOpenMenu: (id: ID, anchor: Anchor) => void;
}

export const HOVER_MS = 3000;
const LONG_PRESS_MS = 650;
const MOVE_THRESHOLD = 6;
const MIN_K = 0.25;
const MAX_K = 2.5;

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function datesOf(p: Person): string {
  if (p.born && p.died) return `${p.born} – ${p.died}`;
  if (p.born) return `b. ${p.born}`;
  if (p.died) return `d. ${p.died}`;
  return '';
}

export function Canvas({ layouts, showAll, treeLabels, people, meId, selectedId, menuOpen, insetRight, insetBottom, centerReq, onSelect, onOpenMenu }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  const [hoverId, setHoverId] = useState<ID | null>(null);
  const hoverIdRef = useRef<ID | null>(null);
  const hoverTimer = useRef(0);
  const longPressTimer = useRef(0);
  const raf = useRef(0);
  const pointers = useRef(new Map<number, Anchor>());
  const gesture = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
    longPressed: false,
    nodeId: null as ID | null,
    addId: null as ID | null,
    pinchDist: 0,
    pinchK: 1,
    lastMidX: 0,
    lastMidY: 0,
  });

  const applyView = useCallback((v: View) => {
    viewRef.current = v;
    setView(v);
  }, []);

  const placements = useMemo(() => {
    let cursor = 0;
    return layouts.map((layout) => {
      if (!showAll) return { layout, ox: 0, oy: 0 };
      const width = layout.bounds.maxX - layout.bounds.minX;
      const placement = { layout, ox: cursor - layout.bounds.minX, oy: -layout.bounds.minY };
      cursor += width + 240;
      return placement;
    });
  }, [layouts, showAll]);

  const worldOf = useMemo(() => {
    const map = new Map<ID, Anchor>();
    for (const { layout, ox, oy } of placements) {
      for (const node of Object.values(layout.nodes)) map.set(node.id, { x: node.x + ox, y: node.y + oy });
    }
    return map;
  }, [placements]);

  const drawn = useMemo(
    () =>
      placements.map(({ layout, ox, oy }) => ({
        layout,
        ox,
        oy,
        connectors: layout.connectors.map((c) => {
          const seed = hashString(c.id);
          return { ...c, main: sketchify(c.d, seed, 1.5), echo: sketchify(c.d, seed + 11, 1.5) };
        }),
      })),
    [placements],
  );

  const animateTo = useCallback(
    (target: View, ms = 450) => {
      cancelAnimationFrame(raf.current);
      const from = viewRef.current;
      if (ms === 0 || prefersReducedMotion()) {
        applyView(target);
        return;
      }
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(1 - t, 3);
        applyView({ x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e });
        if (t < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [applyView],
  );

  // centre / fit on request
  const handled = useRef(-1);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || handled.current === centerReq.n) return;
    const first = handled.current === -1;
    handled.current = centerReq.n;
    const rect = el.getBoundingClientRect();
    const cw = Math.max(200, rect.width - insetRight);
    const ch = Math.max(200, rect.height - insetBottom);
    if (centerReq.target === 'fit') {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const { layout, ox, oy } of placements) {
        minX = Math.min(minX, layout.bounds.minX + ox);
        maxX = Math.max(maxX, layout.bounds.maxX + ox);
        minY = Math.min(minY, layout.bounds.minY + oy);
        maxY = Math.max(maxY, layout.bounds.maxY + oy);
      }
      if (!Number.isFinite(minX)) return;
      const k = clampK(Math.min(cw / (maxX - minX + 180), ch / (maxY - minY + 260), 1));
      animateTo({ k, x: cw / 2 - ((minX + maxX) / 2) * k, y: ch / 2 - ((minY + maxY) / 2) * k }, first ? 0 : 450);
    } else {
      const pos = worldOf.get(centerReq.target);
      if (!pos) return;
      const k = Math.min(1.3, Math.max(0.6, viewRef.current.k));
      animateTo({ k, x: cw / 2 - pos.x * k, y: ch / 2 - pos.y * k }, first ? 0 : 450);
    }
  }, [centerReq, placements, worldOf, insetRight, insetBottom, animateTo]);

  const zoomAt = useCallback(
    (cx: number, cy: number, nextK: number) => {
      const v = viewRef.current;
      const k = clampK(nextK);
      const wx = (cx - v.x) / v.k;
      const wy = (cy - v.y) / v.k;
      applyView({ k, x: cx - wx * k, y: cy - wy * k });
    },
    [applyView],
  );

  // wheel zoom needs a non-passive native listener so the page does not scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnimationFrame(raf.current);
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0016));
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, viewRef.current.k * factor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      window.clearTimeout(hoverTimer.current);
      window.clearTimeout(longPressTimer.current);
    },
    [],
  );

  const anchorFor = useCallback((id: ID): Anchor => {
    const el = containerRef.current?.querySelector(`[data-node="${id}"]`);
    const rect = el?.getBoundingClientRect();
    if (!rect) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return {
      x: rect.left + rect.width / 2,
      y: rect.bottom + 6,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
    };
  }, []);

  const cancelHover = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    hoverIdRef.current = null;
    setHoverId(null);
  }, []);

  const startHover = useCallback(
    (id: ID) => {
      window.clearTimeout(hoverTimer.current);
      hoverIdRef.current = id;
      setHoverId(id);
      hoverTimer.current = window.setTimeout(() => {
        hoverIdRef.current = null;
        setHoverId(null);
        onOpenMenu(id, anchorFor(id));
      }, HOVER_MS);
    },
    [anchorFor, onOpenMenu],
  );

  // an open menu cancels any pending hover
  useEffect(() => {
    if (menuOpen) cancelHover();
  }, [menuOpen, cancelHover]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(raf.current);
    cancelHover();
    const g = gesture.current;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Anchor, Anchor];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      g.pinchK = viewRef.current.k;
      g.lastMidX = (a.x + b.x) / 2;
      g.lastMidY = (a.y + b.y) / 2;
      g.moved = true;
      window.clearTimeout(longPressTimer.current);
      return;
    }

    const target = e.target as Element;
    g.pointerId = e.pointerId;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.originX = viewRef.current.x;
    g.originY = viewRef.current.y;
    g.moved = false;
    g.longPressed = false;
    g.nodeId = target.closest('[data-node]')?.getAttribute('data-node') ?? null;
    g.addId = target.closest('[data-add]')?.getAttribute('data-add') ?? null;
    try {
      containerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer ended already; the gesture simply continues without capture */
    }

    // touch has no hover, so a long press opens the add menu instead
    if (e.pointerType !== 'mouse' && g.nodeId && !g.addId) {
      const id = g.nodeId;
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = window.setTimeout(() => {
        if (g.moved) return;
        g.longPressed = true;
        navigator.vibrate?.(15);
        onOpenMenu(id, anchorFor(id));
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Anchor, Anchor];
      const rect = containerRef.current!.getBoundingClientRect();
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      zoomAt(midX - rect.left, midY - rect.top, g.pinchK * (Math.hypot(a.x - b.x, a.y - b.y) / g.pinchDist));
      const v = viewRef.current;
      applyView({ ...v, x: v.x + (midX - g.lastMidX), y: v.y + (midY - g.lastMidY) });
      g.lastMidX = midX;
      g.lastMidY = midY;
      return;
    }

    if (e.buttons === 0) {
      // plain mouse hover: start the 3-second countdown on a person
      if (e.pointerType !== 'mouse' || menuOpen) return;
      const id = (e.target as Element).closest('[data-node]')?.getAttribute('data-node') ?? null;
      if (id !== hoverIdRef.current) {
        cancelHover();
        if (id) startHover(id);
      }
      return;
    }

    if (e.pointerId !== g.pointerId) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (!g.moved && Math.hypot(dx, dy) > MOVE_THRESHOLD) {
      g.moved = true;
      window.clearTimeout(longPressTimer.current);
    }
    if (g.moved) applyView({ ...viewRef.current, x: g.originX + dx, y: g.originY + dy });
  };

  const endPointer = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const wasPinch = pointers.current.size >= 2;
    pointers.current.delete(e.pointerId);
    window.clearTimeout(longPressTimer.current);
    if (containerRef.current?.hasPointerCapture(e.pointerId)) containerRef.current.releasePointerCapture(e.pointerId);
    if (wasPinch || e.pointerId !== g.pointerId) return;
    g.pointerId = -1;
    if (e.type !== 'pointerup' || g.moved || g.longPressed) return;
    if (g.addId) onOpenMenu(g.addId, anchorFor(g.addId));
    else if (g.nodeId) onSelect(g.nodeId);
    else onSelect(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const id = (e.target as Element).closest?.('[data-node]')?.getAttribute('data-node');
    if (!id) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      onOpenMenu(id, anchorFor(id));
    }
  };

  const style = { '--vx': `${view.x}px`, '--vy': `${view.y}px`, '--vk': view.k } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className="canvas"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={(e) => e.pointerType === 'mouse' && cancelHover()}
      onKeyDown={onKeyDown}
    >
      <svg className="canvas-svg" role="group" aria-label="Family tree">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {drawn.map(({ layout, ox, oy, connectors }, index) => (
            <g key={layout.rootId} transform={`translate(${ox} ${oy})`}>
              {showAll && (
                <text className="tree-title" x={layout.bounds.minX} y={layout.bounds.minY - 44}>
                  {treeLabels[index] ?? ''}
                </text>
              )}
              <g className="connectors">
                {connectors.map((c) => (
                  <g key={c.id} className={`conn conn-${c.kind}`}>
                    <path className="conn-echo" d={c.echo} />
                    <path className="conn-line" d={c.main} />
                  </g>
                ))}
                {connectors.map(
                  (c) =>
                    c.kind === 'partner' &&
                    c.labelX !== undefined && (
                      <path key={`h-${c.id}`} className="heart" transform={`translate(${c.labelX} ${c.labelY})`} d="M0 5 C-12 -3 -6 -11 0 -5 C6 -11 12 -3 0 5 Z" />
                    ),
                )}
                {connectors.map(
                  (c) =>
                    c.kind === 'other' &&
                    c.label && (
                      <text key={`l-${c.id}`} className="conn-label" x={c.labelX} y={c.labelY} textAnchor="middle">
                        {c.label}
                      </text>
                    ),
                )}
              </g>
              {Object.values(layout.nodes).map((n) => {
                const person = people[n.id];
                if (!person) return null;
                return (
                  <PersonNode
                    key={n.id}
                    id={n.id}
                    x={n.x}
                    y={n.y}
                    name={person.name}
                    dates={datesOf(person)}
                    photoId={person.photoId}
                    isMe={meId === n.id}
                    placeholder={person.placeholder}
                    selected={selectedId === n.id}
                    hovering={hoverId === n.id}
                  />
                );
              })}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
