# Árbol MASACOVA

A private, hand-drawn-style family tree for keeping the notes, files and links you collect about your lineage. It is a place to organize what you find, not a tool that searches for it.

- Starts with one blank person. Hover a card for 3 seconds (press and hold on a phone) to add a parent, sibling, cousin, aunt/uncle, grandparent, great-grandparent, great-great-grandparent, child, nephew/niece or any other labelled connection.
- Missing in-between relatives become dashed "Unknown" placeholders you can fill in later.
- Click a person for notes, dates, place, photo, and attached files.
- Mark yourself as "me" and the view centres on you. Unconnected people form separate trees ("All trees" shows them together).
- **Sources** tab: save links, choose who each is about, paste excerpts, send them to a person's notes.
- Undo/redo, backup export/restore, works on phone and computer.

## Run it

```bash
npm install
npm run dev      # development
npm test         # unit tests
npm run build    # production build in dist/
```

Once GitHub Pages is on (Settings → Pages → Source: GitHub Actions) the included workflow publishes it at `https://juanmasacova.github.io/arbol-masacova/`. Open that URL on any device.

## Where your data lives (read this)

This repository is **public**, so it contains code only. Your family data is never committed here.

- **Default:** data stays in your browser (IndexedDB) on the device you use. Nothing is uploaded. Use Settings → Backup to export a file.
- **Optional sync between phone and computer:** Settings → Sync talks to a **separate private** GitHub repo that you create (for example `arbol-data`). Setup:
  1. Create an empty **private** repo.
  2. GitHub → Settings → Developer settings → Fine-grained tokens → new token, limited to **only that repo**, permission *Contents: Read and write*, short expiry.
  3. Paste owner/repo and the token in Settings → Sync on each device.
  The app refuses repos that are not private, refuses read-only tokens, and only ever contacts `api.github.com`. The token is kept for the browser session unless you tick "remember".

## Security notes

- No server, no API keys, nothing running on your computer that others can reach.
- Strict Content-Security-Policy (production): own scripts only, connections only to `api.github.com`; no inline scripts, no source maps.
- Links must be `http(s)`; they open with `noopener noreferrer`.
- Uploads are allow-listed and checked by content (images for photos; documents download-only; SVG/HTML/JS rejected; 10 MB cap).
- Imported backups and synced data are strictly validated.
- **Not built on purpose:** automatically fetching information from pasted links. That would need a server fetching arbitrary URLs, which is the dangerous part. The Sources tab is manual instead.
- `.gitignore` blocks common data file names as a safety net.

See `PLAN.md` for the full plan, threat model and review log.
