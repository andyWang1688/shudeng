#!/usr/bin/env bash
# UI prototype: bundle JS into a separate simulator app, reusing the last native build.
# No product router, database or AI is loaded. No Xcode/CocoaPods build is performed.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="$ROOT/.build/rn-ios/derived/Build/Products/Release-iphonesimulator/app.app"
DEMO="$ROOT/.build/ui-demo"
SIM="${IOS_SIMULATOR_UDID:-1B9B9A35-F2D7-4D87-AB31-6B07D1B27D66}"
BUNDLE_ID=dev.shudeng.visualdemo
PAGE="${1:-shelf}"
case "$PAGE" in shelf|notes|conversations|profile|reader|assistant) ;; *) echo '页面：shelf|notes|conversations|profile|reader|assistant' >&2; exit 2 ;; esac
if [[ ! -d "$BASE" ]]; then
  echo '先运行 scripts/build-ios-rn.sh Release 生成可复用原生包。' >&2
  exit 1
fi
mkdir -p "$DEMO"
STAGE="$(mktemp -d "$DEMO/tmp-XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT INT TERM
APP="$STAGE/ShudengUIDemo.app"
ditto "$BASE" "$APP"
cd "$ROOT/apps/mobile"
EXPO_PUBLIC_UI_DEMO_PAGE="$PAGE" NODE_ENV=production ./node_modules/.bin/expo export:embed \
  --entry-file visual-demo.entry.tsx --platform ios --dev false --minify false \
  --max-workers 2 --bundle-output "$APP/main.jsbundle" --assets-dest "$APP"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$APP/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName 书灯·UI' "$APP/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleURLTypes:0:CFBundleURLSchemes:0 shudeng-ui-demo' "$APP/Info.plist"
/usr/libexec/PlistBuddy -c 'Delete :CFBundleURLTypes:0:CFBundleURLSchemes:1' "$APP/Info.plist"
codesign --force --sign - "$APP"
xcrun simctl install "$SIM" "$APP"
xcrun simctl terminate "$SIM" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl launch "$SIM" "$BUNDLE_ID"
echo '已启动 书灯·UI；再次运行本命令即可更新视觉，无需编译原生。'
