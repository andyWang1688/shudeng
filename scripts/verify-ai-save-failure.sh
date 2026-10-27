#!/bin/sh
set -eu

shudeng_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$shudeng_root/scripts/test_resources.sh"
simulator=$1
result=$2
log=$3
sh "$shudeng_root/scripts/verify-ai-services.sh" --check-simulator "$simulator"
fault="$log.fault-active"
locate() {
  container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
  catalog="$container/Library/Application Support/Shudeng/ai-services.json"
}
cleanup() {
  if [ -f "$fault" ]; then
    locate
    test "$(cat "$fault")" = "$catalog" || return 1
    test ! -f "$catalog" || chflags nouchg "$catalog"
    rm -f "$fault"
  fi
}
watcher=""
finish() {
  if [ -n "$watcher" ]; then kill "$watcher" 2>/dev/null || true; wait "$watcher" 2>/dev/null || true; fi
  cleanup
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cleanup
: > "$log"
(
  for action in INJECT RESTORE; do
    found=0
    for attempt in $(seq 1 180); do
      if rg -q "I7_""$action""_SAVE_FAULT" "$log"; then found=1; break; fi
      sleep 1
    done
    if [ "$found" = 0 ]; then exit 1; fi
    locate
    cp "$catalog" "$log.$action.json"
    printf '%s ' "$action" >> "$log.injection.txt"
    shasum -a 256 "$catalog" >> "$log.injection.txt"
    if [ "$action" = INJECT ]; then
      if stat -f '%Sf' "$catalog" | rg -q '(^|,)uchg(,|$)'; then exit 1; fi
      printf '%s\n' "$catalog" > "$fault"
      chflags uchg "$catalog"
    else cleanup; fi
    ls -lO "$catalog" >> "$log.injection.txt"
  done
) &
watcher=$!
TEST_RUNNER_SHUDENG_AI_SAVE_FAULT=1 sh "$shudeng_root/scripts/verify-ai-services.sh" "$simulator" "$result" "$log" -only-testing:ShudengUITests/AISettingsUITests/testSettingsWriteFailureAndRetry
wait "$watcher"
watcher=""
locate
cp "$catalog" "$log.final.json"
