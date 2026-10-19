import { base64ToText, bytesToBase64, textToBase64 } from './base64';

const API = 'https://api.github.com';

export type SyncErrorCode =
  | 'AUTH'
  | 'PUBLIC_REPO'
  | 'NOT_FOUND'
  | 'READ_ONLY'
  | 'CONFLICT'
  | 'RATE'
  | 'NETWORK'
  | 'INVALID'
  | 'OTHER';

export class SyncError extends Error {
  constructor(
    public readonly code: SyncErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export interface SyncTarget {
  owner: string;
  repo: string;
  branch: string; // blank = the repository's default branch
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._/-]{1,100}$/;

/** Reject anything that could change which URL we call. */
export function validateTarget(t: SyncTarget): string | null {
  if (!OWNER_RE.test(t.owner)) return 'The owner name looks wrong.';
  if (!REPO_RE.test(t.repo) || t.repo === '.' || t.repo === '..') return 'The repository name looks wrong.';
  if (t.branch && (!BRANCH_RE.test(t.branch) || t.branch.includes('..'))) return 'The branch name looks wrong.';
  return null;
}

type FetchLike = typeof fetch;

/** Thin client for the one private "data" repository: tree.json plus files/<id>. */
export class GithubStore {
  constructor(
    private readonly target: SyncTarget,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (...args) => fetch(...args),
  ) {
    const problem = validateTarget(target);
    if (problem) throw new SyncError('INVALID', problem);
    if (!token.trim()) throw new SyncError('AUTH', 'Paste your GitHub access token first.');
  }

  private get repoPath(): string {
    return `/repos/${encodeURIComponent(this.target.owner)}/${encodeURIComponent(this.target.repo)}`;
  }

  private contentPath(path: string): string {
    return `${this.repoPath}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  private refQuery(): string {
    return this.target.branch ? `?ref=${encodeURIComponent(this.target.branch)}` : '';
  }

  private async call(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch {
      throw new SyncError('NETWORK', 'Could not reach GitHub. Check your connection and try again.');
    }
    if (res.status === 401) throw new SyncError('AUTH', 'GitHub did not accept that token. It may be wrong or expired.');
    if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
      throw new SyncError('RATE', 'GitHub is rate-limiting requests. Wait a few minutes and try again.');
    }
    if (res.status === 403) {
      throw new SyncError('AUTH', 'The token is not allowed to do that. It needs “Contents: Read and write” on the data repository.');
    }
    return res;
  }

  /** Must be called before anything else: refuses to touch a repository that is not private. */
  async verify(): Promise<void> {
    const res = await this.call(this.repoPath);
    if (res.status === 404) {
      throw new SyncError('NOT_FOUND', 'Repository not found. Check the name, and that the token has access to it.');
    }
    if (!res.ok) throw new SyncError('OTHER', `GitHub returned an unexpected error (${res.status}).`);
    const info = (await res.json()) as { private?: unknown; permissions?: { push?: unknown } };
    if (info.private !== true) {
      throw new SyncError(
        'PUBLIC_REPO',
        'That repository is public, so anyone could read your family data. Create a PRIVATE repository for your data and use that instead.',
      );
    }
    if (info.permissions && info.permissions.push === false) {
      throw new SyncError('READ_ONLY', 'The token can read but not write to that repository.');
    }
  }

  /** Returns the stored document and its sha, or null when nothing has been saved there yet. */
  async pullTree(): Promise<{ raw: unknown; sha: string } | null> {
    const res = await this.call(`${this.contentPath('tree.json')}${this.refQuery()}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new SyncError('OTHER', `Could not read your tree (${res.status}).`);
    const meta = (await res.json()) as { sha?: string; content?: string; encoding?: string };
    if (typeof meta.sha !== 'string') throw new SyncError('OTHER', 'GitHub sent an unexpected reply.');
    let text: string;
    if (meta.encoding === 'base64' && meta.content) {
      text = base64ToText(meta.content);
    } else {
      const blob = await this.call(`${this.repoPath}/git/blobs/${encodeURIComponent(meta.sha)}`);
      if (!blob.ok) throw new SyncError('OTHER', `Could not read your tree (${blob.status}).`);
      const body = (await blob.json()) as { content?: string };
      text = base64ToText(body.content ?? '');
    }
    try {
      return { raw: JSON.parse(text), sha: meta.sha };
    } catch {
      throw new SyncError('INVALID', 'The saved tree file is damaged.');
    }
  }

  /** Saves the tree. `sha` is the version we last saw; a mismatch means another device saved first. */
  async pushTree(tree: unknown, sha: string | null): Promise<string> {
    const res = await this.call(this.contentPath('tree.json'), {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Update family tree',
        content: textToBase64(JSON.stringify(tree)),
        ...(sha ? { sha } : {}),
        ...(this.target.branch ? { branch: this.target.branch } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) throw new SyncError('CONFLICT', 'Your tree changed on another device.');
    if (res.status === 404) throw new SyncError('NOT_FOUND', 'Repository or branch not found.');
    if (!res.ok) throw new SyncError('OTHER', `Could not save your tree (${res.status}).`);
    const body = (await res.json()) as { content?: { sha?: string } };
    const newSha = body.content?.sha;
    if (typeof newSha !== 'string') throw new SyncError('OTHER', 'GitHub sent an unexpected reply.');
    return newSha;
  }

  async pushFile(id: string, bytes: Uint8Array): Promise<void> {
    const res = await this.call(this.contentPath(`files/${id}`), {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Add file',
        content: bytesToBase64(bytes),
        ...(this.target.branch ? { branch: this.target.branch } : {}),
      }),
    });
    if (res.status === 422 || res.status === 409) return; // already uploaded: ids are write-once
    if (!res.ok) throw new SyncError('OTHER', `Could not upload a file (${res.status}).`);
  }

  async pullFile(id: string): Promise<Uint8Array | null> {
    const res = await this.call(`${this.contentPath(`files/${id}`)}${this.refQuery()}`, {}, 'application/vnd.github.raw+json');
    if (res.status === 404) return null;
    if (!res.ok) throw new SyncError('OTHER', `Could not download a file (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  }
}
