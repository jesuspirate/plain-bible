#!/bin/bash
# Pictures of the verse-of-the-day widget, drawn on a Mac (no phone needed).
# Usage: bash ios/widget-pictures/draw.sh <out-folder>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/out}"
mkdir -p "$out"
work="$(mktemp -d)"
# The widget bundle's @main would clash with the drawing program's.
sed 's/^@main$//' "$here/../QuietBibleHome/HomeWidgets.swift" > "$work/HomeWidgets.swift"
xcrun swiftc -parse-as-library -O -target arm64-apple-macos14.0 \
  "$work/HomeWidgets.swift" "$here/../QuietBibleHome/DailyVerse.swift" \
  "$here/../Shared/SharedVerses.swift" "$here/../Shared/SharedCircles.swift" \
  "$here/Render.swift" -o "$work/render"
"$work/render" "$out"
