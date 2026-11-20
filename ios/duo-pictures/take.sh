#!/bin/bash
# Pictures of the app on Apple's own iPhone Duo simulator (Xcode 27.1 or
# later), so App Store pictures for the folding iPhone start from the real
# screen: its exact pixels, safe areas and fold. No phone and no Xcode on our
# own computers needed. Usage: bash ios/duo-pictures/take.sh <out-folder>
set -uo pipefail
out="$(mkdir -p "${1:-out}" && cd "${1:-out}" && pwd)"
DD="${RUNNER_TEMP:-/tmp}/quietbible-duo-dd"
BUNDLE=com.myquietbible.ios

xcode=$(ls -d /Applications/Xcode_27*.app 2>/dev/null | grep -vi beta | sort -V | tail -1)
if [ -z "$xcode" ]; then echo "No Xcode 27 on this Mac:"; ls -d /Applications/Xcode*; exit 1; fi
sudo xcode-select -s "$xcode"
xcodebuild -version | tee "$out/about-simulator.txt"
{ echo; xcrun simctl list devicetypes; echo; xcrun simctl list runtimes; echo; xcrun simctl help; echo; xcrun simctl help io; } >> "$out/about-simulator.txt" 2>&1

type=$(xcrun simctl list devicetypes | grep -i 'duo' | head -1 | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9.-]+' || true)
runtime=$(xcrun simctl list runtimes available | grep -E '^iOS 2[7-9]' | tail -1 | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.[A-Za-z0-9-]+' || true)
echo "device type: ${type:-none}, runtime: ${runtime:-none}"
if [ -z "$runtime" ]; then
  echo "No iOS 27 simulator yet: downloading it."
  xcodebuild -downloadPlatform iOS
  runtime=$(xcrun simctl list runtimes available | grep -E '^iOS 2[7-9]' | tail -1 | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.[A-Za-z0-9-]+' || true)
fi
if [ -z "$type" ] || [ -z "$runtime" ]; then cat "$out/about-simulator.txt"; exit 1; fi
udid=$(xcrun simctl create "iPhone Duo pictures" "$type" "$runtime")

set -e
xcodebuild -project ios/QuietBible.xcodeproj -scheme QuietBible -configuration Debug \
  -destination "id=$udid" -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO -quiet build
APP=$(ls -d "$DD"/Build/Products/Debug-iphonesimulator/*.app | head -1)

xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b >/dev/null
open -a Simulator --args -CurrentDeviceUDID "$udid" || true
xcrun simctl status_bar "$udid" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 || true
xcrun simctl install "$udid" "$APP"
xcrun simctl launch "$udid" "$BUNDLE"
# First start: the Bible downloads and the tour opens over the reader.
sleep 45
shot() { # $1 name: one picture per screen the simulator lists
  xcrun simctl io "$udid" screenshot "$out/$1.png" || true
  for d in internal external; do xcrun simctl io "$udid" screenshot --display="$d" "$out/$1-$d.png" 2>/dev/null || true; done
}
shot 00-first-start
# Escape closes the tour (Simulator passes the Mac keyboard on).
osascript -e 'tell application "Simulator" to activate' -e 'delay 1' \
  -e 'tell application "System Events" to key code 53' || echo "could not press Escape"
sleep 3
go() { xcrun simctl openurl "$udid" "$2"; sleep 8; shot "$1"; }
go 01-reader-psalm-23 'quietbible://read/KJV/Ps/23'
go 02-reader-john-3 'quietbible://read/KJV/John/3?v=16'
go 03-pray 'quietbible://pray'
go 04-circles 'quietbible://circles'
go 05-reader-again 'quietbible://read/KJV/Ps/23'
# Turned sideways, when the Simulator lets System Events reach it.
osascript -e 'tell application "Simulator" to activate' -e 'delay 1' \
  -e 'tell application "System Events" to key code 123 using command down' && sleep 6 && shot 06-sideways || echo "could not rotate"
for f in "$out"/*.png; do echo "$(basename "$f"): $(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/ {printf "%s ", $2}')"; done | tee "$out/sizes.txt"
