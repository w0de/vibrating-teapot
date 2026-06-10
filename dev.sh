#!/usr/bin/env bash
# Hot-load the extension into a throwaway Firefox profile.
# web-ext watches the source dir and reloads on every change.
#
#   ./dev.sh            # run in Firefox (default)
#   ./dev.sh nightly    # Firefox Nightly / Developer Edition
#
# Requires Node. Uses `web-ext` via npx (no global install needed).
set -euo pipefail

cd "$(dirname "$0")"

exec npx --yes web-ext run \
  --target "${1:-firefox-desktop}" \
  --source-dir .
