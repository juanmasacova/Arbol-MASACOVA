import { useEffect, useState } from 'react';
import { imageUrl } from '../app/files';
import type { ID } from '../model/types';

/** Resolves a stored photo id to a blob: URL (null while loading or when there is no photo). */
export function useImage(photoId: ID | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (photoId) void imageUrl(photoId).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [photoId]);
  return url;
}
