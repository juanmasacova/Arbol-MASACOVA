import { describe, expect, it } from 'vitest';
import { defaultTree } from '../model/defaultTree';
import { classifyFile, safeFileName } from './files';
import { hostOf, safeUrl } from './safeUrl';
import { parseTree } from './validate';

describe('safeUrl', () => {
  it('accepts normal web links and adds https to bare domains', () => {
    expect(safeUrl('https://www.familysearch.org/tree')).toBe('https://www.familysearch.org/tree');
    expect(safeUrl('example.com/page')).toBe('https://example.com/page');
    expect(safeUrl('  http://example.com ')).toBe('http://example.com/');
    expect(safeUrl('example.com:8080/x')).toBe('https://example.com:8080/x');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'blob:https://x.com/abc',
    'mailto:a@b.com',
    'ftp://example.com',
    'https://user:pass@example.com',
    'https://nodots',
    'https://exa mple.com',
    '',
    'https://a.com/\u0000',
  ])('rejects %j', (bad) => {
    expect(safeUrl(bad)).toBeNull();
  });

  it('extracts a readable host', () => {
    expect(hostOf('https://www.example.com/a')).toBe('example.com');
  });
});

describe('classifyFile', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const pdf = new TextEncoder().encode('%PDF-1.7 hello');

  it('accepts a real PNG and PDF', () => {
    expect(classifyFile('a.png', png)).toMatchObject({ ok: true, kind: 'image', type: 'image/png' });
    expect(classifyFile('a.PDF', pdf)).toMatchObject({ ok: true, kind: 'document', type: 'application/pdf' });
  });

  it('rejects script-capable and executable types', () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    for (const name of ['x.svg', 'x.html', 'x.htm', 'x.js', 'x.exe', 'x.xhtml', 'x.xml', 'noext']) {
      expect(classifyFile(name, html).ok, name).toBe(false);
    }
  });

  it('rejects files whose content does not match the extension', () => {
    expect(classifyFile('evil.png', new TextEncoder().encode('<svg onload=alert(1)>')).ok).toBe(false);
    expect(classifyFile('evil.pdf', new TextEncoder().encode('<html>')).ok).toBe(false);
  });

  it('rejects empty and oversized files', () => {
    expect(classifyFile('a.png', new Uint8Array()).ok).toBe(false);
    expect(classifyFile('a.txt', new Uint8Array(10 * 1024 * 1024 + 1).fill(65)).ok).toBe(false);
  });

  it('sanitises download names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('..hidden<>.pdf')).toBe('hidden.pdf');
    expect(safeFileName('')).toBe('file');
  });
});

describe('parseTree', () => {
  it('round-trips a valid tree', () => {
    const tree = defaultTree();
    expect(parseTree(JSON.parse(JSON.stringify(tree)))).toMatchObject({ version: 1, counter: 1 });
  });

  it('rejects documents that are not trees', () => {
    expect(() => parseTree(null)).toThrow();
    expect(() => parseTree({ version: 2, people: {} })).toThrow();
    expect(() => parseTree({ version: 1, people: {} })).toThrow();
  });

  it('drops prototype-pollution ids, dangling edges, bad links and unknown fields', () => {
    const base = defaultTree();
    const id = Object.keys(base.people)[0]!;
    const dirty = JSON.parse(
      JSON.stringify({
        ...base,
        people: { ...base.people, __proto__: { id: '__proto__' }, constructor: { id: 'constructor' } },
        edges: [{ id: 'e_aaaaaaaa', type: 'parent', from: id, to: 'p_missing999', label: '' }],
        sources: [
          { id: 's_aaaaaaaa', url: 'javascript:alert(1)', title: 'x', excerpt: '', personIds: [id] },
          { id: 's_bbbbbbbb', url: 'https://ok.example.com', title: 't', excerpt: 'e', personIds: [id, 'p_ghost12345'] },
        ],
        evil: '<img onerror=alert(1)>',
      }),
    );
    dirty.people.__proto__ = { id: '__proto__' };
    const clean = parseTree(dirty);
    expect(Object.keys(clean.people)).toEqual([id]);
    expect(clean.edges).toHaveLength(0);
    expect(clean.sources).toHaveLength(1);
    expect(clean.sources[0]!.personIds).toEqual([id]);
    expect('evil' in clean).toBe(false);
    expect(({} as Record<string, unknown>).id).toBeUndefined();
  });

  it('caps oversized strings and strips disallowed file types', () => {
    const base = defaultTree();
    const id = Object.keys(base.people)[0]!;
    const person = {
      ...base.people[id]!,
      notes: 'x'.repeat(50000),
      files: [
        { id: 'f_aaaaaaaa', name: 'ok.pdf', type: 'application/pdf', size: 10 },
        { id: 'f_bbbbbbbb', name: 'bad.svg', type: 'image/svg+xml', size: 10 },
      ],
    };
    const clean = parseTree({ ...base, people: { [id]: person } });
    expect(clean.people[id]!.notes.length).toBe(20000);
    expect(clean.people[id]!.files.map((f) => f.name)).toEqual(['ok.pdf']);
  });
});
