#!/usr/bin/env bash
# Build the web app for the iOS app and copy it into the Xcode project.
# Needs the Bible data first (npm run data). Then open ios/App/App.xcodeproj
# in Xcode, or let the "iOS app" workflow build it.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
python3 scripts/ios_bundle.py dist
npx cap sync ios
