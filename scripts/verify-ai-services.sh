#!/bin/sh
# Local simulator verification only; no Apple account or real credential required.
set -eu
simulator=$1
result=$2
log=$3
shift 3
entitlements=$(mktemp /tmp/shudeng-issue7-entitlements.XXXXXX)
trap 'rm -f "$entitlements"' EXIT INT TERM
cat > "$entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>application-identifier</key><string>LOCALTEST.dev.shudeng.app</string>
<key>keychain-access-groups</key><array><string>LOCALTEST.dev.shudeng.app</string></array>
</dict></plist>
PLIST
# Simulator securityd reads the Mach-O section. Do not put restricted iOS
# entitlements in a host ad-hoc signature (macOS will refuse to launch it).
xcodebuild -project ios/Shudeng.xcodeproj -scheme Shudeng -destination "platform=iOS Simulator,id=$simulator" -derivedDataPath /tmp/shudeng-issue7-derived -clonedSourcePackagesDirPath /tmp/shudeng-readium-spm -disableAutomaticPackageResolution -parallel-testing-enabled NO -collect-test-diagnostics never CODE_SIGNING_ALLOWED=NO ENABLE_DEBUG_DYLIB=NO "OTHER_LDFLAGS=\$(inherited) -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __entitlements -Xlinker $entitlements" build-for-testing > "$log.build" 2>&1
# Reinstall only the test runner; never uninstall the app or its data.
xcrun simctl uninstall "$simulator" dev.shudeng.app.uitests.xctrunner >/dev/null 2>&1 || true
xcodebuild -project ios/Shudeng.xcodeproj -scheme Shudeng -destination "platform=iOS Simulator,id=$simulator" -derivedDataPath /tmp/shudeng-issue7-derived -clonedSourcePackagesDirPath /tmp/shudeng-readium-spm -disableAutomaticPackageResolution -parallel-testing-enabled NO -collect-test-diagnostics never -resultBundlePath "$result" CODE_SIGNING_ALLOWED=NO "$@" test-without-building > "$log" 2>&1
