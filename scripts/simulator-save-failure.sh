#!/bin/sh
# Reversible real filesystem fault; only for the named simulator test workflow.
set -eu
mode=${1:?Usage: sh scripts/simulator-save-failure.sh start-or-restore simulator-udid}
simulator=${2:?Specify the test simulator UDID}
case "$mode" in start|restore) ;; *) exit 2 ;; esac
container=$(xcrun simctl get_app_container "$simulator" dev.shudeng.app data)
catalog="$container/Library/Application Support/Shudeng/library.json"
test -f "$catalog"
case "$mode" in
  start) chflags uchg "$catalog"; echo 'Write failure enabled; existing committed catalog remains readable.' ;;
  restore) chflags nouchg "$catalog"; echo 'Writes restored; tap 重试保存 in the reader.' ;;
esac
