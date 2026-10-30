#!/bin/bash
# AP-10: builds Pi Hub for the Mac (signed, copied to ~/Applications) and the iOS Simulator.
# With IOS_TEAM=<Enterprise team id> it also exports a signed In-House .ipa for iPhone/iPad (D9).
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

if [ -n "${IOS_TEAM:-}" ]; then
  # Enterprise In-House (D9): archive unsigned, then the export signs it; Xcode makes the "iOS Team Inhouse" profile itself.
  rm -rf "$OUT/PiHub.xcarchive" "$OUT/ipa"
  xcodebuild -quiet -project PiHub.xcodeproj -scheme PiHub -configuration Release -destination 'generic/platform=iOS' \
    -archivePath "$OUT/PiHub.xcarchive" DEVELOPMENT_TEAM="$IOS_TEAM" CODE_SIGNING_ALLOWED=NO archive
  printf '%s' "<plist><dict><key>method</key><string>enterprise</string><key>teamID</key><string>$IOS_TEAM</string><key>signingStyle</key><string>automatic</string></dict></plist>" > "$OUT/export.plist"
  xcodebuild -quiet -exportArchive -archivePath "$OUT/PiHub.xcarchive" -exportOptionsPlist "$OUT/export.plist" \
    -exportPath "$OUT/ipa" -allowProvisioningUpdates
  echo "iPhone/iPad: $OUT/ipa/Pi Hub.ipa (install: xcrun devicectl device install app --device <id> \"$OUT/ipa/Pi Hub.ipa\")"
else
  echo "iPhone/iPad: skipped (set IOS_TEAM to your Enterprise team id)"
fi
