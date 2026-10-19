# Árbol MASACOVA — Development Plan

A private, doodle-styled family tree notebook. It is **not** a research or lookup tool: it is a place to
organize what *you* find about your lineage — notes, dates, files and links per person.

## 1. Requirements (from the brief)

| # | Requirement | Where it lands |
|---|-------------|----------------|
| R1 | Starts with one blank person ("Person 1"), no photo or info | `defaultTree()` in `src/model` |
| R2 | Hover a profile for **3 seconds** → add-relative menu appears | `useHoverIntent` + `AddMenu` |
| R3 | Menu: parent, sibling, cousin, aunt/uncle, grandparent, great-grandparent, great-great-grandparent, son/daughter, nephew/niece, any other connection | relation engine (§4) |
| R4 | New person appears with a family-tree style connector to the person it was created from | layout + `Connectors` |
| R5 | Click a person → notes, info, files, links | `PersonPanel` |
| R6 | Mark yourself as the main person → UI centers around you | `isMe` flag + `viewport.centerOn` |
| R7 | Multiple people / unconnected trees shown as separate trees | connected-components + tree switcher |
| R8 | Sources tab: add links, pick which person(s) they belong to | `SourcesTab` (see §6, deliberately manual) |
| R9 | Doodly / sketch look; green, cream, orange; clean UX | design tokens + SVG roughen filter |
| R10 | Works on computer **and** phone from the repo | static site, GitHub Pages deploy, responsive + touch |
| R11 | Security: nobody but the owner can reach personal data | threat model (§6) |

## 2. Key decision: the repo is public, so data must never live in it

`juanmasacova/arbol-masacova` is a **public** repository. Anything committed to it is world-readable, and
GitHub Pages sites are public URLs even when built from private repos (except on Enterprise plans). So:

* **This repo holds code only.** Zero personal data, ever. The deployed site is an empty shell.
* **Data lives in the browser (IndexedDB) by default**, and can optionally **sync to a separate *private*
  repo** (e.g. `arbol-data`) using a fine-grained token scoped to that one repo. "Only people with access to
  the repo" then becomes literally true: access to the data == access to the private data repo.
* The app **refuses to sync** if the target repo reports `private: false`.

## 3. Architecture

* **Stack:** Vite + React 19 + TypeScript (strict). Vitest for tests. Runtime deps kept minimal
  (`react`, `react-dom`, self-hosted `@fontsource` fonts) to shrink supply-chain risk.
* **No backend, no API keys.** Everything runs in the browser; the only network call is to
  `api.github.com` for optional sync.
* **State:** one `useReducer` store holding the `Tree` document; every change goes through pure reducer
  actions, which makes undo and testing straightforward.
* **Rendering:** a single SVG canvas with pan/zoom (pointer events + wheel + pinch). SVG `feTurbulence` +
  `feDisplacementMap` filter gives all strokes a hand-drawn wobble.
* **Persistence:** `storage/local.ts` (IndexedDB: `tree` document + `files` blobs) and `storage/github.ts`
  (Contents API, optimistic concurrency on `sha`).
* **Deploy:** GitHub Actions → GitHub Pages (static `dist/`). Also runs locally with `npm run dev`.

```
src/
  model/      types, defaultTree, reducer, validation
  relations/  relation definitions + planAdd() (pure, tested)
  layout/     generations, ordering, x-positioning, components (pure, tested)
  storage/    local (IndexedDB), github (sync), export/import
  ui/         Canvas, PersonNode, Connectors, AddMenu, PersonPanel, SourcesTab, Toolbar, dialogs
  styles/     tokens.css (green/cream/orange), sketch.css
  security/   safeUrl, file type allow-list, sanitizers
```

## 4. Data model and the relation engine

```ts
Person  { id, name, nickname?, born?, died?, place?, notes, photoId?, placeholder?, files[] }  (links live in Sources, tagged to people)
Edge    { id, type: 'parent' | 'partner' | 'other', from, to, label? }   // parent: from=parent → to=child
Source  { id, url, title, excerpt, personIds[] }
Tree    { version, people, edges, sources, meId? }
```

Only three edge types are stored; every menu option is a **path** over them, so there is one code path
for all relations:

| Option | Path from the source person S |
|--------|-------------------------------|
| Parent | new parent of S (if S has exactly one parent, the new one becomes that parent's partner) |
| Partner | new partner of S |
| Sibling | new child of S's parents (a placeholder parent is created if S has none) |
| Son / daughter | new child of S (and of S's partner when S has exactly one) |
| Grandparent / great- / great-great- | up 2 / 3 / 4 generations |
| Aunt-uncle / great-aunt-uncle | up 1 (or 2), then a sibling of that ancestor |
| Cousin | up 2, down to an aunt/uncle, down to the new cousin |
| Nephew-niece | a sibling of S, then a new child of that sibling |
| Grandchild / great-grandchild | down 2 / 3 |
| Other connection | free-text label, dashed line, same generation as S |

`planAdd(tree, sourceId, relation, choices)` walks the steps. For each intermediate step it **reuses an
existing person** if one fits, **asks which one** if several do (e.g. "through which parent?"), and
otherwise **creates a placeholder** (dashed outline, "Unknown") so the tree stays structurally valid. The
final step always creates the new person. A person may have at most two parent edges.

## 5. Layout

1. **Components** via union-find over all edges → separate trees (R7).
2. **Generation** by constraint propagation from a root (me, else first person): parent = child − 1,
   partner / sibling / other = same row. Conflicting edges are ignored, never crash.
3. **Order** each row by depth-first walk so partners and siblings sit together.
4. **X-positioning**: initial slots, then ~10 passes of "centre parents over children, pull children toward
   parents" with a minimum-gap collision sweep.
5. Connectors are orthogonal: partner bar, drop to a shared bus, branch down to each child.
6. "Mark as me" re-roots generation numbering at that person and animates the viewport to centre them.

## 6. Security plan and threat model

| Threat | Mitigation |
|--------|-----------|
| Personal data exposed in the public repo | Data never committed here; sync target must be a different, private repo; app blocks sync when `private !== true` |
| Public Pages site leaking data | Site is a static shell; no data bundled; `noindex`; no analytics; no third-party requests |
| Stolen sync token | Fine-grained token, **one repo, Contents read/write only, expiry ≤ 90 days**; kept in `sessionStorage` unless the user ticks "remember on this device"; never logged or put in URLs |
| XSS reading the token or data | Strict CSP (`default-src 'self'`; `script-src 'self'`; `connect-src 'self' https://api.github.com`; `object-src 'none'`; `frame-ancestors` via meta where possible); React escaping only, **no `dangerouslySetInnerHTML`**; no CDN scripts; fonts self-hosted; lockfile + `npm audit` |
| Malicious links in Sources / notes | `safeUrl()` allows only `http:`/`https:`; links open with `rel="noopener noreferrer"`; shown with their domain |
| Malicious uploaded files (SVG/HTML run on the app's origin) | Allow-list: raster images for photos; documents (PDF, text, Office) as **download-only**; SVG, HTML, JS, and unknown types rejected; 10 MB cap; blobs are never navigated to |
| "Auto-find info from a link" feature | **Not built.** It needs a server that fetches arbitrary URLs (SSRF, API keys, scraping legal issues). Sources tab saves the link and lets you paste your own excerpt, then attach it to a person's notes |
| Two devices overwrite each other | Sync uses file `sha`; on conflict the user chooses *load remote* or *overwrite*; local export always available |
| Data loss | Export/import JSON; autosave; 30-step in-session undo |
| Source maps / debug leaks | Source maps off in production builds |

## 7. UX details

* **3-second hover** shows a ring progress doodle, then the add menu. Moving away cancels it.
* **Touch:** long-press (0.7 s) opens the same menu; keyboard: focus a person and press `+`. A visible
  "＋ Add relative" button is also in the panel, so nothing depends on hover.
* New person is selected right away with the **name field focused**.
* Panel: name, dates (free text so "c. 1890" works), place, photo, notes, links, files, relationships list,
  "This is me", delete (confirm shows what becomes disconnected).
* Sidebar tabs: **Tree · Sources · People · Settings** (sync, export/import). Bottom sheet on phones.
* Palette: cream `#fbf3df` paper, forest green `#2f6b3a` ink/lines, orange `#e8792b` accents; hand-written
  fonts (Patrick Hand / Caveat) bundled locally. Contrast checked for text on cream.

## 8. Test strategy

* **Unit (Vitest):** every relation option, placeholder creation, choice prompts, two-parent cap,
  generation conflicts, components, layout no-overlap, URL and file validation, sync conflict handling
  (mocked `fetch`).
* **Build gate:** `tsc --noEmit`, tests, `vite build`.
* **Manual/visual:** headless-browser screenshots at desktop and phone widths, hover-menu timing check.

## 9. Milestones

1. Scaffold, tokens, CSP, CI. 2. Model + relation engine + tests. 3. Layout + tests. 4. Canvas and nodes.
5. Hover/long-press menu and add flow. 6. Person panel. 7. Sources tab. 8. Local persistence, export/import.
9. GitHub private-repo sync. 10. Polish, a11y, mobile. 11. Deploy and README.

## 10. Plan review log

A critical pass over the first draft found these problems; the plan above already includes the fixes.

1. **Repo is public** → storing data "in the repo" would have exposed it. Split code and data (§2).
2. **Pages is public even for private repos** → can't rely on it as an access wall; shell holds no data.
3. **Token in browser storage is an XSS target** → CSP, no third-party code, opt-in persistence.
4. **Auto-fetching from links is dangerous** → removed; manual excerpts only (the brief allowed dropping it).
5. **Hover-only menu fails on phones and keyboards** → long-press, visible button, `+` key.
6. **Cousin / aunt / great-grandparent need nodes that may not exist** → path engine with placeholders.
7. **Blob URLs of uploaded HTML/SVG would run on the app origin** → allow-list and download-only.
8. **Two-device sync could silently clobber data** → `sha` concurrency + conflict dialog.
9. **Deleting someone can split a tree unexpectedly** → confirmation that lists what disconnects.
10. **Service worker offline mode adds attack surface** → skipped; a web manifest gives "Add to Home Screen".
