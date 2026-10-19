import { LIMITS } from '../model/types';

/**
 * Normalise a user-typed link. Returns null unless it is a plain http(s) URL without embedded credentials.
 * Anything else (javascript:, data:, file:, blob:, mailto:…) is rejected so it can never be rendered as a link.
 */
export function safeUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw || raw.length > LIMITS.url || /[\u0000-\u001f\u007f\s]/.test(raw)) return null;
  const looksLikeHostPort = /^[a-z0-9.-]+:\d+(\/|$)/i.test(raw);
  if (!looksLikeHostPort && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  else if (looksLikeHostPort) raw = `https://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
  return url.href;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
