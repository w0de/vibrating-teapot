# Teapot

A single-purpose Firefox toolbar button. Click it on any page and it finds the
**latest archive.today snapshot** of that URL and opens it **in reader mode**.
No snapshot? It pours you a `418 I'm a teapot`.

You can also **right-click any link → "Steep this link"** to open the archived,
reader-mode version of where it points — handy for peeking past a paywall before
you commit the click.

## Install (Firefox)

1. On the [**latest release**](https://github.com/w0de/vibrating-teapot/releases/latest),
   download `teapot-<version>.xpi`.
2. Open the downloaded file in Firefox. It asks *“Add Teapot?”* — click **Add**.

It's signed by Mozilla, so it stays installed and **updates itself** from there
on. No `about:debugging`, no re-loading after a restart.

## How it works

- Queries the mirrors `archive.ph`, `archive.today`, `archive.li`,
  `archive.md`, trying the one that has been answering fastest first and fanning
  out to the rest only if it stalls (each request is capped by a short timeout).
  Mirror speeds are tracked across lookups, so the ranking adapts. An empty
  answer ("nothing archived") still counts as the archive working — that's when
  you get the 418.
- Results are cached per URL, so re-opening the same page is instant (found
  snapshots for 30 min, unarchived pages for 5).
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
