#!/bin/sh
set -eu

shudeng_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$shudeng_root/scripts/test_resources.sh"
simulator=${1:?Specify the test simulator UDID}
result=${2:?Specify a new xcresult path}
log=${3:?Specify a log path}
test_method=${4:-testStorageFailureAndRetry}
sh scripts/simulator-save-failure.sh start "$simulator"
cleanup() { sh scripts/simulator-save-failure.sh restore "$simulator"; }
trap cleanup EXIT INT TERM
: > "$log"
(
  for attempt in $(seq 1 180); do
    if rg -q 'Tap.*重试保存' "$log"; then cleanup; exit 0; fi
    sleep 1
  done
  cleanup
) &
watcher=$!
TEST_RUNNER_SHUDENG_STORAGE_FAULT=1 shudeng_xcodebuild --profile simulator-contracts -- -project ios/Shudeng.xcodeproj -scheme Shudeng -destination "platform=iOS Simulator,id=$simulator" -parallel-testing-enabled NO -collect-test-diagnostics never "-only-testing:ShudengUITests/ReadingUITests/$test_method" -resultBundlePath "$result" CODE_SIGNING_ALLOWED=NO test > "$log" 2>&1
wait "$watcher"
