# Teapot

A single-purpose Firefox toolbar button. Click it on any page and it finds the
**latest archive.today snapshot** of that URL and opens it **in reader mode**.
No snapshot? It pours you a `418 I'm a teapot`.

## Install (macOS / Linux)

One line — downloads the latest release, extracts it, copies the
`manifest.json` path to your clipboard, and opens Firefox to the loader. Then
click **Load Temporary Add-on…** and **paste** the path into the file picker.

```sh
D="$HOME/.local/share/vibrating-teapot"; mkdir -p "$D" && curl -fsSL https://github.com/w0de/vibrating-teapot/releases/latest/download/vibrating-teapot.tar.gz | tar -xzf - -C "$D" && printf '%s' "$D/manifest.json" | (pbcopy 2>/dev/null || xclip -selection clipboard 2>/dev/null || xsel -ib 2>/dev/null || true) && echo "→ Load Temporary Add-on… and paste (now on your clipboard): $D/manifest.json" && (open -a Firefox "about:debugging#/runtime/this-firefox" 2>/dev/null || (firefox "about:debugging#/runtime/this-firefox" >/dev/null 2>&1 &))
```

## Install (Windows)

Same idea, in PowerShell — the `manifest.json` path lands on your clipboard;
paste it into the **Load Temporary Add-on…** file picker.

```powershell
$D="$env:LOCALAPPDATA\vibrating-teapot"; ni $D -ItemType Directory -Force | Out-Null; iwr https://github.com/w0de/vibrating-teapot/releases/latest/download/vibrating-teapot.tar.gz -OutFile "$env:TEMP\vt.tgz"; tar -xzf "$env:TEMP\vt.tgz" -C $D; "$D\manifest.json" | Set-Clipboard; Start-Process firefox "about:debugging#/runtime/this-firefox"; "→ Load Temporary Add-on… and paste (now on your clipboard): $D\manifest.json"
```

A temporary add-on lasts until you restart Firefox (unsigned extensions can't be
installed permanently on release Firefox). Re-run the line — or just reopen
`about:debugging#/runtime/this-firefox` and re-pick the same `manifest.json` — to
load it again.

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

## Development

Hot-load the extension into a throwaway Firefox profile that **reloads on every
save** — no manual re-pick in `about:debugging`:

```sh
./dev.sh            # launch in Firefox
./dev.sh nightly    # use Firefox Nightly / Developer Edition
```

`dev.sh` wraps Mozilla's [`web-ext run`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-run),
fetched on demand via `npx` (needs Node; nothing to install globally). It opens
a clean profile, sideloads the extension, and watches the source dir — edit a
file, save, and the extension reloads automatically.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`, which packs the
extension into `vibrating-teapot.tar.gz` and attaches it to a GitHub Release.
