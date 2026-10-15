#!/bin/sh
set -eu
simulator=$1
result=$2
log=$3
locate() {
  container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
  database="$container/Library/Application Support/Shudeng/book-index.sqlite"
}
cleanup() { locate; sqlite3 "$database" "DROP TRIGGER IF EXISTS issue9_prepare_fault"; }
trap 'cleanup' EXIT INT TERM
sh scripts/verify-ai-services.sh "$simulator" "$result" "$log" -only-testing:ShudengUITests/ReadingUITests/testQuestionIncompletePreparationWaitThenExplicitLocalChoice &
runner=$!
while kill -0 "$runner" 2>/dev/null; do
  if test -f "$log" && rg -q I9_INJECT_PREPARATION_FAULT "$log"; then
    locate
    sqlite3 "$database" "CREATE TRIGGER issue9_prepare_fault BEFORE INSERT ON fragments WHEN NEW.book_id='3c78bfd8640c246c6a6efa49667f89b3f7819721b22c9b9682281d79c97183c3' BEGIN SELECT RAISE(ABORT,'controlled fixture failure'); END"
    break
  fi
  sleep 0.2
done
while kill -0 "$runner" 2>/dev/null; do
  if rg -q I9_RESTORE_PREPARATION_FAULT "$log"; then
    sqlite3 "$database" "DROP TRIGGER IF EXISTS issue9_prepare_fault"
    break
  fi
  sleep 0.2
done
wait "$runner"
