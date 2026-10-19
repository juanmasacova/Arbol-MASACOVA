import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, textToBase64 } from './base64';
import { GithubStore, SyncError, validateTarget } from './github';

interface FakeRepo {
  private: boolean;
  push?: boolean;
  files: Map<string, { content: string; sha: string }>;
}

/** A tiny in-memory stand-in for the parts of the GitHub API the app uses. */
function fakeGithub(repo: FakeRepo) {
  const calls: { method: string; url: string; auth: string | null; body?: unknown }[] = [];
  let counter = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = init?.headers as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, auth: headers?.Authorization ?? null, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });

    if (headers?.Authorization !== 'Bearer good-token') return json(401, {});
    const path = new URL(url).pathname;

    if (path === '/repos/me/data') {
      return json(200, { private: repo.private, permissions: { push: repo.push ?? true } });
    }
    const m = path.match(/^\/repos\/me\/data\/contents\/(.+)$/);
    if (m) {
      const file = decodeURIComponent(m[1]!);
      if (method === 'GET') {
        const f = repo.files.get(file);
        if (!f) return json(404, {});
        if (headers?.Accept?.includes('raw')) return new Response(base64ToBytes(f.content) as unknown as BodyInit);
        return json(200, { sha: f.sha, content: f.content, encoding: 'base64' });
      }
      if (method === 'PUT') {
        const existing = repo.files.get(file);
        if (existing && body.sha !== existing.sha) return json(409, {});
        if (!existing && body.sha) return json(422, {});
        if (existing && !body.sha) return json(422, {});
        const sha = `sha${++counter}`;
        repo.files.set(file, { content: body.content, sha });
        return json(200, { content: { sha } });
      }
    }
    return json(404, {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const target = { owner: 'me', repo: 'data', branch: '' };

describe('GithubStore', () => {
  it('refuses to use a public repository', async () => {
    const { fetchImpl } = fakeGithub({ private: false, files: new Map() });
    const store = new GithubStore(target, 'good-token', fetchImpl);
    await expect(store.verify()).rejects.toMatchObject({ code: 'PUBLIC_REPO' });
  });

  it('accepts a private repository and refuses a read-only token', async () => {
    const ok = fakeGithub({ private: true, files: new Map() });
    await expect(new GithubStore(target, 'good-token', ok.fetchImpl).verify()).resolves.toBeUndefined();
    const ro = fakeGithub({ private: true, push: false, files: new Map() });
    await expect(new GithubStore(target, 'good-token', ro.fetchImpl).verify()).rejects.toMatchObject({ code: 'READ_ONLY' });
  });

  it('reports a bad token without echoing it', async () => {
    const { fetchImpl } = fakeGithub({ private: true, files: new Map() });
    const store = new GithubStore(target, 'secret-bad-token', fetchImpl);
    const error = await store.verify().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect((error as SyncError).code).toBe('AUTH');
    expect((error as SyncError).message).not.toContain('secret-bad-token');
  });

  it('saves and loads the tree, including non-ASCII text', async () => {
    const { fetchImpl } = fakeGithub({ private: true, files: new Map() });
    const store = new GithubStore(target, 'good-token', fetchImpl);
    expect(await store.pullTree()).toBeNull();
    const tree = { version: 1, note: 'Abuela María — Girona ☀️' };
    const sha = await store.pushTree(tree, null);
    const loaded = await store.pullTree();
    expect(loaded).toEqual({ raw: tree, sha });
  });

  it('detects a conflict when another device saved first', async () => {
    const { fetchImpl } = fakeGithub({ private: true, files: new Map() });
    const store = new GithubStore(target, 'good-token', fetchImpl);
    const first = await store.pushTree({ v: 1 }, null);
    await store.pushTree({ v: 2 }, first); // other device
    await expect(store.pushTree({ v: 3 }, first)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('uploads and downloads binary files, and treats a repeat upload as success', async () => {
    const { fetchImpl } = fakeGithub({ private: true, files: new Map() });
    const store = new GithubStore(target, 'good-token', fetchImpl);
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await store.pushFile('f_abc12345', bytes);
    await store.pushFile('f_abc12345', bytes);
    expect([...(await store.pullFile('f_abc12345'))!]).toEqual([...bytes]);
    expect(await store.pullFile('f_missing00')).toBeNull();
  });

  it('only ever sends the token to api.github.com', async () => {
    const fake = fakeGithub({ private: true, files: new Map() });
    const store = new GithubStore(target, 'good-token', fake.fetchImpl);
    await store.verify();
    await store.pushTree({ a: 1 }, null);
    for (const c of fake.calls) expect(new URL(c.url).origin).toBe('https://api.github.com');
  });
});

describe('validateTarget', () => {
  it('rejects values that could redirect the request', () => {
    expect(validateTarget({ owner: 'me', repo: 'data', branch: '' })).toBeNull();
    expect(validateTarget({ owner: 'me/../x', repo: 'data', branch: '' })).not.toBeNull();
    expect(validateTarget({ owner: 'me', repo: 'da ta?x=1', branch: '' })).not.toBeNull();
    expect(validateTarget({ owner: 'me', repo: '..', branch: '' })).not.toBeNull();
    expect(validateTarget({ owner: 'me', repo: 'data', branch: 'a/../b' })).not.toBeNull();
    expect(validateTarget({ owner: '-bad', repo: 'data', branch: '' })).not.toBeNull();
  });
});

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes and large buffers', () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect([...base64ToBytes(bytesToBase64(big))]).toEqual([...big]);
    expect(textToBase64('é')).toBe('w6k=');
  });
});
