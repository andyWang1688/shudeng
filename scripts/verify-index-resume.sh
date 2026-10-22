#!/bin/sh
set -eu

shudeng_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$shudeng_root/scripts/test_resources.sh"
simulator=${1:?Specify simulator UDID}
result=${2:?Specify new xcresult path}
log=${3:?Specify log path}
test_id=4aa9213d7e01875d35c2bd6f4409c5e902c9b57a5ce7c4ea8c03e8e888396ce8
: > "$log"
(
  for attempt in $(seq 1 180); do
    if rg -q I8_LONG_TERMINATED "$log"; then
      container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
      index="$container/Library/Application Support/Shudeng/book-index.sqlite"
      sqlite3 "$index" ".backup '${log}.interrupted.sqlite'"
      sqlite3 "${log}.interrupted.sqlite" "SELECT completed,total FROM preparations WHERE book_id='$test_id'; SELECT count(*) FROM chapters WHERE book_id='$test_id';" > "${log}.checkpoint.txt"
      exit 0
    fi
    sleep 1
  done
  exit 1
) &
watcher=$!
trap 'kill "$watcher" 2>/dev/null || true' EXIT INT TERM
shudeng_xcodebuild --profile simulator-contracts -- -project ios/Shudeng.xcodeproj -scheme Shudeng -destination "platform=iOS Simulator,id=$simulator" -disableAutomaticPackageResolution -parallel-testing-enabled NO -collect-test-diagnostics never -only-testing:ShudengUITests/ReadingUITests/testBookPreparationLongImportReadInterruptAndResume -resultBundlePath "$result" CODE_SIGNING_ALLOWED=NO test-without-building > "$log" 2>&1
wait "$watcher"
container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
sqlite3 "$container/Library/Application Support/Shudeng/book-index.sqlite" ".backup '${log}.final.sqlite'"
sqlite3 "${log}.final.sqlite" "SELECT completed,total FROM preparations WHERE book_id='$test_id'; SELECT count(*) FROM fragments WHERE book_id='$test_id'; PRAGMA integrity_check;" > "${log}.final.txt"
