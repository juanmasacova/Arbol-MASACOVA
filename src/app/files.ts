import { newId } from '../model/ids';
import type { FileItem, ID } from '../model/types';
import { classifyFile, isImageType, safeFileName, sniffImageType } from '../security/files';
import { putFile, getFile, deleteFile } from '../storage/local';

type RemoteLoader = (id: ID) => Promise<Uint8Array | null>;
let remoteLoader: RemoteLoader | null = null;

/** The sync layer registers itself here so files saved on another device can be fetched on demand. */
export function setRemoteFileLoader(loader: RemoteLoader | null): void {
  remoteLoader = loader;
}

const urlCache = new Map<ID, string>();
const pending = new Map<ID, Promise<string | null>>();

export async function storeUpload(file: File, mode: 'photo' | 'document'): Promise<{ item: FileItem } | { error: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = classifyFile(file.name, bytes);
  if (!check.ok) return { error: check.reason };
  if (mode === 'photo' && check.kind !== 'image') return { error: 'Please choose an image (JPG, PNG, WebP or GIF).' };
  const id = newId('f');
  await putFile(id, bytes, check.type);
  return { item: { id, name: safeFileName(file.name), type: check.type, size: bytes.length } };
}

async function bytesFor(id: ID, expectedType: string | null): Promise<{ bytes: Uint8Array; type: string } | null> {
  const local = await getFile(id);
  if (local) return { bytes: new Uint8Array(local.bytes), type: expectedType ?? local.type };
  const remote = remoteLoader ? await remoteLoader(id).catch(() => null) : null;
  if (!remote) return null;
  // remote data is untrusted: re-check it before it can be shown or downloaded
  const type = expectedType ?? sniffImageType(remote);
  if (!type || (isImageType(type) && sniffImageType(remote) !== type)) return null;
  await putFile(id, remote, type);
  return { bytes: remote, type };
}

/** A blob: URL for an image, cached per file id. Only image types are ever turned into URLs this way. */
export function imageUrl(id: ID): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return Promise.resolve(cached);
  let job = pending.get(id);
  if (!job) {
    job = (async () => {
      const found = await bytesFor(id, null);
      if (!found || !isImageType(found.type)) return null;
      const url = URL.createObjectURL(new Blob([found.bytes.slice().buffer], { type: found.type }));
      urlCache.set(id, url);
      return url;
    })().finally(() => pending.delete(id));
    pending.set(id, job);
  }
  return job;
}

/** Documents are never opened in the browser: they are saved to disk with a sanitised name. */
export async function downloadDocument(item: FileItem): Promise<boolean> {
  const found = await bytesFor(item.id, item.type);
  if (!found) return false;
  const url = URL.createObjectURL(new Blob([found.bytes.slice().buffer], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(item.name);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export async function discardFile(id: ID): Promise<void> {
  const url = urlCache.get(id);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(id);
  await deleteFile(id).catch(() => undefined);
}

export async function readLocalFile(id: ID): Promise<Uint8Array | null> {
  const stored = await getFile(id);
  return stored ? new Uint8Array(stored.bytes) : null;
}
