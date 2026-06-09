# Teapot

A single-purpose Firefox toolbar button. Click it on any page and it finds the
**latest archive.today snapshot** of that URL and opens it **in reader mode**.
No snapshot? It pours you a `412 I'm a teapot`.

## How it works

- Tries the mirrors `archive.ph → archive.today → archive.li → archive.md` in
  order and uses the first one that answers. An empty answer ("nothing
  archived") still counts as the archive working — that's when you get the 412.
- Snapshots are located via each mirror's Memento **TimeMap**; the newest
  memento is opened.
- Reader mode is applied through Firefox's own reader once the page is
  detected as an article.

## Preferences  (about:addons → Teapot → Preferences)

- **Reader mode** — open the snapshot stripped to text. *Default: on.*
- **Dark mode** — dim the extension's screens, and the archived page when
  reader mode is off (in reader mode, Firefox's reader theme handles it).
  *Default: on.*

## Install (temporary, for development)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…**
3. Pick `manifest.json` in this folder.

To package for signing: zip the folder's contents (not the folder itself) and
submit to addons.mozilla.org, or use `web-ext build`.
