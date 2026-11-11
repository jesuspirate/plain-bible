#!/bin/bash
# Starts a prayer in the watch app on a watch simulator and checks that the
# app is still running afterwards: once at the microphone question, once with
# the microphone allowed. Prints the crash report if it isn't.
# Run from the repository root on a Mac with Xcode: bash ios/watch-smoke.sh
set -euo pipefail

BUNDLE=com.myquietbible.ios.watchkitapp
DD="${RUNNER_TEMP:-/tmp}/quietbible-watch-dd"

xcodebuild -project ios/QuietBible.xcodeproj -scheme QuietBibleWatch -configuration Debug \
  -destination 'generic/platform=watchOS Simulator' -derivedDataPath "$DD" \
  CODE_SIGNING_ALLOWED=NO -quiet build
APP="$DD/Build/Products/Debug-watchsimulator/QuietBibleWatch.app"

UDID=$(xcrun simctl list devices available | grep -i 'Apple Watch' | head -n 1 | grep -oE '[0-9A-F-]{36}' || true)
if [ -z "$UDID" ]; then
  echo "No watch simulator on this Mac:"; xcrun simctl list runtimes; exit 1
fi
xcrun simctl list devices available | grep "$UDID"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" "$APP"

reports() {
  echo "---- crash reports ----"
  sleep 8
  for f in "$HOME"/Library/Logs/DiagnosticReports/QuietBibleWatch*; do
    [ -e "$f" ] || continue
    echo "== $f"; head -c 12000 "$f"; echo
  done
  echo "---- the app's own log ----"
  xcrun simctl spawn "$UDID" log show --last 2m --style compact \
    --predicate 'process == "QuietBibleWatch"' 2>/dev/null | tail -n 60 || true
}

pray() { # $1: what this round checks
  xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
  local out pid
  out=$(xcrun simctl launch "$UDID" "$BUNDLE" -startPraying)
  pid=${out##*: }
  sleep 12
  if kill -0 "$pid" 2>/dev/null; then
    echo "ok: $1 (still running, pid $pid)"
  else
    echo "FAILED: $1 (the app closed)"; reports; exit 1
  fi
}

pray "starting a prayer, at the microphone question"
xcrun simctl privacy "$UDID" grant microphone "$BUNDLE"
pray "starting a prayer with the microphone allowed"
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
xcrun simctl shutdown "$UDID" || true
