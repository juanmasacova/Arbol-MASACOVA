import type { ID } from './types';

const ID_PATTERN = /^[pesf]_[A-Za-z0-9]{6,40}$/;

/** Random id such as p_9f2c4a1b7d3e. Uses getRandomValues so it also works on plain-http dev servers. */
export function newId(prefix: 'p' | 'e' | 's' | 'f'): ID {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `${prefix}_${hex}`;
}

/** Ids from imported/synced data must match this, which also rules out "__proto__" style keys. */
export function isValidId(value: unknown): value is ID {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
