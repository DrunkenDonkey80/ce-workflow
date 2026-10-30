#!/bin/bash
# AP-10: builds Pi Hub for the Mac (signed, copied to ~/Applications) and the iOS Simulator.
# With IOS_PROFILE=<In-House profile name> (D9, AP-16) it also builds a signed iPhone/iPad app.
set -euo pipefail
cd "$(dirname "$0")"
OUT=build
node ../app/build-icons.mjs 2>/dev/null # C-01: the strip's icons from hub/web/icons.ts

# The Mac app is unsandboxed and needs no entitlements: any Apple Development identity signs it (else ad hoc), like Pi Screen Helper.
MAC_ID=$(security find-identity -v -p codesigning | sed -n 's/.*\([0-9A-F]\{40\}\) "Apple Development:.*/\1/p' | head -1)
xcodebuild -quiet -project PiHub.xcodeproj -scheme PiHub -configuration Release -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath "$OUT" CODE_SIGN_IDENTITY="${MAC_ID:--}" build
mkdir -p ~/Applications
rm -rf ~/Applications/"Pi Hub.app"
cp -R "$OUT/Build/Products/Release/Pi Hub.app" ~/Applications/
echo "Mac: ~/Applications/Pi Hub.app (signed ${MAC_ID:-ad hoc})"

xcodebuild -quiet -project PiHub.xcodeproj -scheme PiHub -configuration Release -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$OUT" build
echo "Simulator: $OUT/Build/Products/Release-iphonesimulator/Pi Hub.app"

if [ -n "${IOS_PROFILE:-}" ]; then
  xcodebuild -quiet -project PiHub.xcodeproj -scheme PiHub -configuration Release -destination 'generic/platform=iOS' \
    -derivedDataPath "$OUT" DEVELOPMENT_TEAM=SB2F4HT97P CODE_SIGN_IDENTITY="iPhone Distribution: Datecs LTD" \
    PROVISIONING_PROFILE_SPECIFIER="$IOS_PROFILE" build
  echo "iPhone/iPad: $OUT/Build/Products/Release-iphoneos/Pi Hub.app"
else
  echo "iPhone/iPad: skipped (set IOS_PROFILE to the In-House profile's name)"
fi
