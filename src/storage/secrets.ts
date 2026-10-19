/**
 * Sync settings. The repository name is not secret; the access token is.
 * By default the token lives in sessionStorage (gone when the tab closes). Only if the user ticks
 * "Remember on this device" is it kept in localStorage.
 */
const CONFIG_KEY = 'arbol.sync.config';
const TOKEN_KEY = 'arbol.sync.token';

export interface StoredSyncConfig {
  owner: string;
  repo: string;
  branch: string;
  remember: boolean;
}

export function loadSyncConfig(): StoredSyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { owner, repo, branch, remember } = parsed as Record<string, unknown>;
    if (typeof owner !== 'string' || typeof repo !== 'string') return null;
    return { owner, repo, branch: typeof branch === 'string' ? branch : '', remember: remember === true };
  } catch {
    return null;
  }
}

export function saveSyncConfig(config: StoredSyncConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* storage unavailable: sync simply will not be remembered */
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string, remember: boolean): void {
  clearToken();
  try {
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function clearSyncSettings(): void {
  clearToken();
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* ignore */
  }
}
