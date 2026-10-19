import { memo, useMemo } from 'react';
import { NODE_H, NODE_W } from '../layout/layout';
import { circlePath, hashString, roundedRectPath, sketchify } from '../layout/sketch';
import type { ID } from '../model/types';
import { useImage } from './useImage';

export interface PersonNodeProps {
  id: ID;
  x: number;
  y: number;
  name: string;
  dates: string;
  photoId: ID | null;
  isMe: boolean;
  placeholder: boolean;
  selected: boolean;
  hovering: boolean;
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function PersonNodeView({ id, x, y, name, dates, photoId, isMe, placeholder, selected, hovering }: PersonNodeProps) {
  const photo = useImage(photoId);
  const label = name.trim() || 'Unnamed';
  const w = NODE_W;
  const h = NODE_H;

  // hand-drawn outlines, stable per person
  const shapes = useMemo(() => {
    const seed = hashString(id);
    return {
      card: sketchify(roundedRectPath(w, h, 16), seed, 1.3, 18),
      cardEcho: sketchify(roundedRectPath(w, h, 16), seed + 1, 1.3, 18),
      avatar: circlePath(0, -19, 23, seed),
      head: circlePath(0, -26, 7.5, seed + 2),
      shoulders: sketchify('M -13 -3 Q 0 -21 13 -3', seed + 3, 0.6, 8),
    };
  }, [id, w, h]);

  return (
    <g
      className={`node${selected ? ' is-selected' : ''}${isMe ? ' is-me' : ''}${placeholder ? ' is-placeholder' : ''}`}
      transform={`translate(${x} ${y})`}
      data-node={id}
      tabIndex={0}
      role="button"
      aria-label={`${label}${isMe ? ' (you)' : ''}${dates ? `, ${dates}` : ''}. Press Enter to open, plus to add a relative.`}
    >
      <title>{label}</title>
      <rect x={-w / 2 - 6} y={-h / 2 - 6} width={w + 12} height={h + 12} fill="transparent" />
      <path className="node-card-echo" d={shapes.cardEcho} />
      <path className="node-card" d={shapes.card} />
      <path className="node-avatar" d={shapes.avatar} />
      {!photo && (
        <>
          <path className="node-silhouette" d={shapes.head} />
          <path className="node-silhouette node-line" d={shapes.shoulders} />
        </>
      )}
      {photo && (
        <>
          <clipPath id={`clip-${id}`}>
            <circle cx={0} cy={-19} r={21} />
          </clipPath>
          <image href={photo} x={-21} y={-40} width={42} height={42} preserveAspectRatio="xMidYMid slice" clipPath={`url(#clip-${id})`} />
        </>
      )}
      <text className="node-name" x={0} y={27} textAnchor="middle">
        {truncate(label, 17)}
      </text>
      {dates && (
        <text className="node-dates" x={0} y={42} textAnchor="middle">
          {truncate(dates, 22)}
        </text>
      )}
      {isMe && (
        <g className="node-me" transform={`translate(${-w / 2 + 6} ${-h / 2 + 2})`}>
          <rect x={-2} y={-12} width={34} height={20} rx={9} />
          <text x={15} y={3} textAnchor="middle">
            me
          </text>
        </g>
      )}
      {hovering && <rect key="ring" className="hover-ring" x={-w / 2 - 6} y={-h / 2 - 6} width={w + 12} height={h + 12} rx={21} pathLength={1} />}
      <g className="node-add" data-add={id} transform={`translate(${w / 2 - 4} ${h / 2 - 4})`}>
        <circle r={13} />
        <path d="M-6 0H6M0 -6V6" />
      </g>
    </g>
  );
}

export const PersonNode = memo(PersonNodeView);
