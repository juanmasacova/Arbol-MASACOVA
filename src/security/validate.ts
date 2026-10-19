import { isValidId } from '../model/ids';
import { LIMITS, type Edge, type EdgeType, type FileItem, type ID, type Person, type Source, type Tree } from '../model/types';
import { ALLOWED_MIME_TYPES, safeFileName } from './files';
import { safeUrl } from './safeUrl';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Turn untrusted JSON (an import file, or data pulled from the sync repo) into a clean Tree.
 * Unknown fields are dropped, strings are length-capped, ids must match our own format, and edges that
 * point at missing people are discarded. Throws only if the document is not a tree at all.
 */
const OFFSET_MAX = 20000;
const offsetNumber = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(-OFFSET_MAX, Math.min(OFFSET_MAX, Math.round(v))) : 0;
function offsetOf(value: Record<string, unknown>): { dx?: number; dy?: number } {
  const dx = offsetNumber(value.dx);
  const dy = offsetNumber(value.dy);
  return dx || dy ? { dx, dy } : {};
}

export function parseTree(raw: unknown): Tree {
  if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.people)) {
    throw new Error('This is not an Árbol tree file.');
  }
  const entries = Object.entries(raw.people);
  if (entries.length === 0 || entries.length > LIMITS.maxPeople) {
    throw new Error('The tree has no people or is too large.');
  }

  const people: Record<ID, Person> = {};
  for (const [key, value] of entries) {
    if (!isValidId(key) || !isRecord(value) || value.id !== key) continue;
    const files: FileItem[] = [];
    if (Array.isArray(value.files)) {
      for (const f of value.files.slice(0, 200)) {
        if (!isRecord(f) || !isValidId(f.id) || typeof f.type !== 'string' || !ALLOWED_MIME_TYPES.has(f.type)) continue;
        files.push({
          id: f.id,
          name: safeFileName(text(f.name, 100)),
          type: f.type,
          size: typeof f.size === 'number' && f.size >= 0 && f.size <= LIMITS.fileBytes ? Math.floor(f.size) : 0,
        });
      }
    }
    people[key] = {
      id: key,
      name: text(value.name, LIMITS.name),
      nickname: text(value.nickname, LIMITS.short),
      born: text(value.born, LIMITS.short),
      died: text(value.died, LIMITS.short),
      place: text(value.place, LIMITS.short),
      notes: text(value.notes, LIMITS.notes),
      photoId: isValidId(value.photoId) ? value.photoId : null,
      placeholder: value.placeholder === true,
      files,
      ...offsetOf(value),
    };
  }
  if (Object.keys(people).length === 0) throw new Error('No valid people were found.');

  const edges: Edge[] = [];
  const seen = new Set<string>();
  const types: EdgeType[] = ['parent', 'partner', 'other'];
  if (Array.isArray(raw.edges)) {
    for (const e of raw.edges.slice(0, LIMITS.maxPeople * 6)) {
      if (!isRecord(e) || !isValidId(e.id) || !isValidId(e.from) || !isValidId(e.to)) continue;
      if (!types.includes(e.type as EdgeType) || e.from === e.to || !people[e.from] || !people[e.to]) continue;
      const key = `${e.type}:${e.from}:${e.to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ id: e.id, type: e.type as EdgeType, from: e.from, to: e.to, label: text(e.label, 60) });
    }
  }

  const sources: Source[] = [];
  if (Array.isArray(raw.sources)) {
    for (const s of raw.sources.slice(0, 5000)) {
      if (!isRecord(s) || !isValidId(s.id) || typeof s.url !== 'string') continue;
      const url = safeUrl(s.url);
      if (!url) continue;
      sources.push({
        id: s.id,
        url,
        title: text(s.title, LIMITS.short),
        excerpt: text(s.excerpt, LIMITS.excerpt),
        personIds: Array.isArray(s.personIds) ? s.personIds.filter((p): p is ID => isValidId(p) && !!people[p]) : [],
        addedAt: text(s.addedAt, 40) || new Date().toISOString(),
      });
    }
  }

  const count = Object.keys(people).length;
  return {
    version: 1,
    people,
    edges,
    sources,
    meId: isValidId(raw.meId) && people[raw.meId] ? raw.meId : null,
    counter: typeof raw.counter === 'number' && Number.isFinite(raw.counter) ? Math.min(Math.max(Math.floor(raw.counter), count), 1_000_000) : count,
    updatedAt: text(raw.updatedAt, 40) || new Date().toISOString(),
  };
}
