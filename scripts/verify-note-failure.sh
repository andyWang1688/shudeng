#!/bin/sh
set -eu

shudeng_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$shudeng_root/scripts/test_resources.sh"
simulator=${1:?Specify test simulator UDID}
result=${2:?Specify new xcresult path}
log=${3:?Specify log path}
test_method=${4:-testNoteHighlightRealWriteFailureAndRetry}
phases=${5:-HIGHLIGHT}
locate() {
  container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
  catalog="$container/Library/Application Support/Shudeng/library.json"
}
cleanup() { locate; test ! -f "$catalog" || chflags nouchg "$catalog"; }
trap cleanup EXIT INT TERM
: > "$log"
(
  for phase in $phases; do
    for action in INJECT RESTORE; do
      found=0
      for attempt in $(seq 1 180); do
        if rg -q "N6_${action}_${phase}_FAULT" "$log"; then found=1; break; fi
        sleep 1
      done
      if [ "$found" = 0 ]; then cleanup; exit 1; fi
      locate
      printf "N6_FAULT action=%s phase=%s catalog=%s\n" "$action" "$phase" "$catalog" >> "${log}.injection.txt"
      cp "$catalog" "${log}.${phase}.${action}.json"
      if [ "$action" = INJECT ]; then chflags uchg "$catalog"; else cleanup; fi
      ls -lO "$catalog" >> "${log}.injection.txt"
    done
  done
) &
watcher=$!
trap 'cleanup; kill "$watcher" 2>/dev/null || true' EXIT INT TERM
TEST_RUNNER_SHUDENG_NOTE_FAULT=1 shudeng_xcodebuild --profile simulator-contracts -- -project ios/Shudeng.xcodeproj -scheme Shudeng -destination "platform=iOS Simulator,id=$simulator" -parallel-testing-enabled NO -collect-test-diagnostics never "-only-testing:ShudengUITests/ReadingUITests/$test_method" -resultBundlePath "$result" CODE_SIGNING_ALLOWED=NO test > "$log" 2>&1
wait "$watcher"
locate
cp "$catalog" "${log}.final.json"
