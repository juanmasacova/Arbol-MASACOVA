import { classifyFile } from '../security/files';
import { parseTree } from '../security/validate';
import type { ID, Tree } from '../model/types';
import { base64ToBytes, bytesToBase64 } from './base64';
import { getFile } from './local';

export interface BackupFile {
  bytes: Uint8Array;
  type: string;
}

export interface ParsedBackup {
  tree: Tree;
  files: Map<ID, BackupFile>;
}

const referencedFileIds = (tree: Tree): Set<ID> => {
  const ids = new Set<ID>();
  for (const p of Object.values(tree.people)) {
    if (p.photoId) ids.add(p.photoId);
    for (const f of p.files) ids.add(f.id);
  }
  return ids;
};

/** A single JSON file containing the tree and every attached file (base64). Keep it somewhere private. */
export async function buildBackup(tree: Tree): Promise<Blob> {
  const files: Record<string, { type: string; data: string }> = {};
  for (const id of referencedFileIds(tree)) {
    const stored = await getFile(id);
    if (stored) files[id] = { type: stored.type, data: bytesToBase64(new Uint8Array(stored.bytes)) };
  }
  const payload = { app: 'arbol-masacova', exportedAt: new Date().toISOString(), tree, files };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

/** Validates everything in a backup file: the tree structure, and every file against the allow-list. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null) throw new Error('That is not an Árbol backup.');
  const record = raw as Record<string, unknown>;
  const tree = parseTree(record.tree ?? raw); // also accepts a bare tree.json
  const files = new Map<ID, BackupFile>();
  const stored = typeof record.files === 'object' && record.files !== null ? (record.files as Record<string, unknown>) : {};

  const names = new Map<ID, string>();
  for (const p of Object.values(tree.people)) {
    for (const f of p.files) names.set(f.id, f.name);
    if (p.photoId) names.set(p.photoId, names.get(p.photoId) ?? 'photo.jpg');
  }
  for (const [id, entry] of Object.entries(stored)) {
    if (!names.has(id) || typeof entry !== 'object' || entry === null) continue;
    const data = (entry as Record<string, unknown>).data;
    if (typeof data !== 'string') continue;
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(data);
    } catch {
      continue;
    }
    // photos have no stored name, so try each image extension
    const photoOwner = Object.values(tree.people).some((p) => p.photoId === id);
    const candidates = photoOwner ? ['a.png', 'a.jpg', 'a.gif', 'a.webp'] : [names.get(id)!];
    for (const candidate of candidates) {
      const check = classifyFile(candidate, bytes);
      if (check.ok && (!photoOwner || check.kind === 'image')) {
        files.set(id, { bytes, type: check.type });
        break;
      }
    }
  }
  return { tree, files };
}
