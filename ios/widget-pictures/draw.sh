#!/bin/bash
# Pictures of the verse-of-the-day widget, drawn in an iPhone simulator on a
# Mac (no phone needed). Usage: bash ios/widget-pictures/draw.sh <out-folder>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$(mkdir -p "${1:-$here/out}" && cd "${1:-$here/out}" && pwd)"
work="$(mktemp -d)"
# The widget bundle's @main would clash with the drawing program's.
sed 's/^@main$//' "$here/../QuietBibleHome/HomeWidgets.swift" > "$work/HomeWidgets.swift"
xcrun --sdk iphonesimulator swiftc -parse-as-library -target "$(uname -m)-apple-ios17.0-simulator" \
  "$work/HomeWidgets.swift" "$here/../QuietBibleHome/DailyVerse.swift" \
  "$here/../Shared/SharedVerses.swift" "$here/../Shared/SharedCircles.swift" \
  "$here/Render.swift" -o "$work/render"
phone="$(xcrun simctl list devices available | grep -m1 -E '^ +iPhone' | grep -oE '[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}')"
xcrun simctl boot "$phone" 2>/dev/null || true
xcrun simctl bootstatus "$phone" -b >/dev/null
xcrun simctl spawn "$phone" "$work/render" "$out"
