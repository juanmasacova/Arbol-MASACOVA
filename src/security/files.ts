import { LIMITS } from '../model/types';

/**
 * Uploaded files are stored in the browser (and optionally your private data repo) and later handed back
 * as blob URLs on the app's own origin. A malicious HTML or SVG file opened that way could run script with
 * access to your data, so only a strict allow-list is accepted:
 *   - photos: raster images only, verified by their first bytes
 *   - documents: download-only (never navigated to or rendered inline)
 */
export type FileKind = 'image' | 'document';

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(IMAGE_TYPES),
  ...Object.values(DOCUMENT_TYPES),
]);

export const ACCEPT_ATTR = [
  ...Object.keys(IMAGE_TYPES),
  ...Object.keys(DOCUMENT_TYPES),
].map((e) => `.${e}`).join(',');

export const PHOTO_ACCEPT_ATTR = Object.keys(IMAGE_TYPES).map((e) => `.${e}`).join(',');

export type FileCheck = { ok: true; type: string; kind: FileKind } | { ok: false; reason: string };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, s: string, at = 0) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/** Decide whether a file may be stored. The browser-reported MIME type is never trusted. */
export function classifyFile(name: string, bytes: Uint8Array): FileCheck {
  if (bytes.length === 0) return { ok: false, reason: 'That file is empty.' };
  if (bytes.length > LIMITS.fileBytes) {
    return { ok: false, reason: `Files can be at most ${LIMITS.fileBytes / 1024 / 1024} MB.` };
  }
  const ext = extensionOf(name);

  const imageType = IMAGE_TYPES[ext];
  if (imageType) {
    const good =
      (ext === 'png' && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) ||
      ((ext === 'jpg' || ext === 'jpeg') && startsWith(bytes, [0xff, 0xd8, 0xff])) ||
      (ext === 'gif' && ascii(bytes, 'GIF8')) ||
      (ext === 'webp' && ascii(bytes, 'RIFF') && ascii(bytes, 'WEBP', 8));
    return good ? { ok: true, type: imageType, kind: 'image' } : { ok: false, reason: 'That does not look like a real image.' };
  }

  const docType = DOCUMENT_TYPES[ext];
  if (docType) {
    let good = true;
    if (ext === 'pdf') good = ascii(bytes, '%PDF');
    else if (['docx', 'xlsx', 'pptx', 'odt', 'ods'].includes(ext)) good = startsWith(bytes, [0x50, 0x4b]);
    else if (['doc', 'xls', 'ppt'].includes(ext)) good = startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]);
    else good = !bytes.subarray(0, 4096).includes(0); // plain text must not contain NUL bytes
    return good ? { ok: true, type: docType, kind: 'document' } : { ok: false, reason: 'That file does not match its type.' };
  }

  return {
    ok: false,
    reason: ext
      ? `“.${ext}” files are not allowed. Use images, PDFs, text or Office documents.`
      : 'Files need an extension such as .pdf or .jpg.',
  };
}

/** The MIME type of a raster image judged only by its first bytes, or null if it is not one we allow. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(bytes, 'GIF8')) return 'image/gif';
  if (ascii(bytes, 'RIFF') && ascii(bytes, 'WEBP', 8)) return 'image/webp';
  return null;
}

/** A safe download name: no paths, control characters or leading dots. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return (cleaned || 'file').slice(0, 100);
}

export function isImageType(type: string): boolean {
  return Object.values(IMAGE_TYPES).includes(type);
}
