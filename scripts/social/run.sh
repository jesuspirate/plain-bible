#!/usr/bin/env bash
# Builds and runs scripts/social/post.ts (see there). Needs `npm ci` first,
# and Playwright's Chromium (the workflow installs it).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export ROOT OUT="${OUT:-$ROOT/social-out}"
mkdir -p "$OUT"
E="$ROOT/node_modules/.bin/esbuild"
# The app's own picture code, for the page that draws.
"$E" "$ROOT/src/lib/versePicture.ts" --bundle --format=iife --global-name=VersePicture --log-level=warning --outfile="$OUT/picture.js"
"$E" "$ROOT/scripts/social/post.ts" --bundle --platform=node --format=esm --packages=external --log-level=warning --outfile="$OUT/post.mjs"
# Run from the repository root, so `playwright` resolves from node_modules.
cd "$ROOT" && cp "$OUT/post.mjs" "$ROOT/scripts/social/.post.mjs" && trap 'rm -f "$ROOT/scripts/social/.post.mjs"' EXIT
node "$ROOT/scripts/social/.post.mjs" "$@"
