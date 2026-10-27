#!/bin/sh
# Local simulator verification only; no Apple account or real credential required.
set -eu

shudeng_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$shudeng_root/scripts/test_resources.sh"
check_only=0
if [ "${1:-}" = --check-simulator ]; then check_only=1; shift; fi
simulator=${1:?Pass a dedicated QA simulator UDID}
simulator_name=$(xcrun simctl list devices available --json | "$SHUDENG_TEST_PYTHON" -c '
import json, sys
print(next((d["name"] for devices in json.load(sys.stdin)["devices"].values() for d in devices if d["udid"] == sys.argv[1]), ""))
' "$simulator")
case "$simulator_name" in
  Shudeng-AI-QA-*|Shudeng-Issue[0-9]*-QA-*) ;;
  *) printf '%s\n' 'Refusing to use a personal simulator. Create a fresh Shudeng-AI-QA-* simulator for these tests.' >&2; exit 1 ;;
esac
if [ "$check_only" = 1 ]; then exit 0; fi
result=$2
log=$3
shift 3
# Use the same simulator signing/access group as an ordinary Xcode install.
shudeng_xcodebuild --profile simulator-contracts -- -project ios/Shudeng.xcodeproj -scheme Shudeng -destination "platform=iOS Simulator,id=$simulator" -disableAutomaticPackageResolution -parallel-testing-enabled NO -collect-test-diagnostics never -resultBundlePath "$result.build.xcresult" CODE_SIGNING_ALLOWED=YES build-for-testing > "$log.build" 2>&1
shudeng_xcodebuild --profile simulator-contracts -- -project ios/Shudeng.xcodeproj -scheme Shudeng -destination "platform=iOS Simulator,id=$simulator" -disableAutomaticPackageResolution -parallel-testing-enabled NO -collect-test-diagnostics never -resultBundlePath "$result" CODE_SIGNING_ALLOWED=YES "$@" test-without-building > "$log" 2>&1
