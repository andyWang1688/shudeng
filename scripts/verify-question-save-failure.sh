#!/bin/sh
# Resolve the container after installation; simulator installs can relocate it.
set -eu
simulator=$1
result=$2
log=$3
locate() {
  container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
  file="$container/Library/Application Support/Shudeng/reading-questions.json"
}
cleanup() { locate; test ! -f "$file" || chflags nouchg "$file"; }
: > "$log"
(
  for action in INJECT RESTORE; do
    found=0
    for attempt in $(seq 1 240); do
      if rg -q "I9_""$action""_ANSWER_WRITE_FAULT" "$log"; then found=1; break; fi
      sleep 1
    done
    test "$found" = 1
    locate
    cp "$file" "$log.$action.json"
    if test "$action" = INJECT; then chflags uchg "$file"; else cleanup; fi
    ls -lO "$file" >> "$log.injection.txt"
  done
) &
watcher=$!
trap 'cleanup; kill "$watcher" 2>/dev/null || true' EXIT INT TERM
sh scripts/verify-ai-services.sh "$simulator" "$result" "$log" -only-testing:ShudengUITests/ReadingUITests/testQuestionRealAnswerWriteFailureAndSameOperationRetry
wait "$watcher"
locate
cp "$file" "$log.final.json"
