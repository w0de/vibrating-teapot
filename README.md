# Teapot

A single-purpose Firefox toolbar button. Click it on any page and it finds the
**latest archive.today snapshot** of that URL and opens it **in reader mode**.
No snapshot? It pours you a `418 I'm a teapot`.

## Install (macOS / Linux)

One line — downloads the latest release, extracts it, and opens Firefox to the
loader. Then click **Load Temporary Add-on…** and pick the `manifest.json` it
prints.

```sh
D="$HOME/.local/share/vibrating-teapot"; mkdir -p "$D" && curl -fsSL https://github.com/w0de/vibrating-teapot/releases/latest/download/vibrating-teapot.tar.gz | tar -xzf - -C "$D" && echo "→ Load Temporary Add-on… and pick $D/manifest.json" && (open -a Firefox "about:debugging#/runtime/this-firefox" 2>/dev/null || (firefox "about:debugging#/runtime/this-firefox" >/dev/null 2>&1 &))
```

A temporary add-on lasts until you restart Firefox (unsigned extensions can't be
installed permanently on release Firefox). Re-run the line — or just the
`about:debugging` part — to load it again. Windows users: you're on your own.

## How it works

- Tries the mirrors `archive.ph → archive.today → archive.li → archive.md` in
  order and uses the first one that answers. An empty answer ("nothing
  archived") still counts as the archive working — that's when you get the 418.
- Snapshots are located via each mirror's Memento **TimeMap**; the newest
  memento is opened.
- Reader mode is applied through Firefox's own reader once the page is
  detected as an article.

## Preferences  (about:addons → Teapot → Preferences)

- **Reader mode** — open the snapshot stripped to text. *Default: on.*
- **Dark mode** — dim the extension's screens, and the archived page when
  reader mode is off (in reader mode, Firefox's reader theme handles it).
  *Default: on.*

## Install (from source)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…**
3. Pick `manifest.json` in this folder.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which packs the
extension into `vibrating-teapot.tar.gz` and attaches it to a GitHub Release.
