#!/bin/sh
set -eu

shudeng_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$shudeng_root/scripts/test_resources.sh"
simulator=$1
result=$2
log=$3
locate() {
  container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
  catalog="$container/Library/Application Support/Shudeng/ai-services.json"
}
cleanup() { locate; test ! -f "$catalog" || chflags nouchg "$catalog"; }
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
    if [ "$action" = INJECT ]; then chflags uchg "$catalog"; else cleanup; fi
    ls -lO "$catalog" >> "$log.injection.txt"
  done
) &
watcher=$!
trap 'cleanup; kill "$watcher" 2>/dev/null || true' EXIT INT TERM
sh scripts/verify-ai-services.sh "$simulator" "$result" "$log" -only-testing:ShudengUITests/AISettingsUITests/testSettingsWriteFailureAndRetry
wait "$watcher"
locate
cp "$catalog" "$log.final.json"
