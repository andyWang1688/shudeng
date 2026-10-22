#!/bin/sh
set -eu

shudeng_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$shudeng_root/scripts/test_resources.sh"
simulator=${1:?Specify simulator UDID}
result=${2:?Specify new xcresult path}
log=${3:?Specify log path}
locate() {
  container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
  index="$container/Library/Application Support/Shudeng/book-index.sqlite"
}
cleanup() { locate; test ! -f "$index" || chflags nouchg "$index"; }
trap cleanup EXIT INT TERM
: > "$log"
(
  for action in INJECT RESTORE; do
    found=0
    for attempt in $(seq 1 180); do
      if rg -q "I8_${action}_INDEX_FAULT" "$log"; then found=1; break; fi
      sleep 1
    done
    if [ "$found" = 0 ]; then cleanup; exit 1; fi
    locate
    sqlite3 "$index" ".backup '${log}.${action}.sqlite'"
    cp "$container/Library/Application Support/Shudeng/library.json" "${log}.${action}.library.json"
    cp "$container/Library/Application Support/Shudeng/ai-services.json" "${log}.${action}.ai-services.json"
    if [ "$action" = INJECT ]; then chflags uchg "$index"; else cleanup; fi
    ls -lO "$index" >> "${log}.injection.txt"
  done
) &
watcher=$!
trap 'cleanup; kill "$watcher" 2>/dev/null || true' EXIT INT TERM
TEST_RUNNER_SHUDENG_INDEX_FAULT=1 shudeng_xcodebuild --profile simulator-contracts -- -project ios/Shudeng.xcodeproj -scheme Shudeng -destination "platform=iOS Simulator,id=$simulator" -disableAutomaticPackageResolution -parallel-testing-enabled NO -collect-test-diagnostics never -only-testing:ShudengUITests/ReadingUITests/testBookPreparationRealWriteFailureRetryAndReading -resultBundlePath "$result" CODE_SIGNING_ALLOWED=NO test-without-building > "$log" 2>&1
wait "$watcher"
locate
sqlite3 "$index" ".backup '${log}.final.sqlite'"
