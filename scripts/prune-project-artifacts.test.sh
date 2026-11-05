#!/usr/bin/env bash
# Isolated regression: no real project caches or Simulator data are touched.
set -Eeuo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/shudeng-prune-test.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p "$fixture/scripts"
cp "$repo/scripts/prune-project-artifacts.sh" "$repo/scripts/build-ios-rn.sh" "$fixture/scripts/"
prune="$fixture/scripts/prune-project-artifacts.sh"
build="$fixture/scripts/build-ios-rn.sh"
artifacts="$fixture/.build/artifacts/rn-ios"
mkdir -p "$artifacts"
printf keep > "$fixture/sentinel"
bash "$prune"
[[ -d "$artifacts" && -f "$fixture/sentinel" ]]
for config in Debug Release; do
  mkdir -p "$artifacts/$config-20260101-000000/app.app" "$artifacts/$config-20260102-000000/app.app"
  touch -t 202601010000 "$artifacts/$config-20260101-000000"
  touch -t 202601020000 "$artifacts/$config-20260102-000000"
done
mkdir -p "$artifacts/Release-20250101-000000/app.app" "$artifacts/parity-preserved/app.app"
printf book > "$artifacts/Release-20250101-000000/book.epub"
mkdir -p "$fixture/.scratch/old/Shudeng.app" "$fixture/.scratch/new/Shudeng.app" \
  "$fixture/.scratch/data-before" "$fixture/.scratch/work" "$fixture/.scratch/report.xcresult" \
  "$fixture/.scratch/profile.trace" "$fixture/.scratch/module-cache" \
  "$fixture/.scratch/epub-file-port-staging/.build" "$fixture/.scratch/epub-file-port-staging/.cache"
touch "$fixture/.scratch/epub-file-port-staging/Package.swift"
mkdir -p "$fixture/.scratch/new/Shudeng.app/module-cache"
printf native > "$fixture/.scratch/new/Shudeng.app/module-cache/native.dylib"
touch -t 202601010000 "$fixture/.scratch/old/Shudeng.app"
touch -t 202601020000 "$fixture/.scratch/new/Shudeng.app"
printf database > "$fixture/.scratch/data-before/library.sqlite"
printf book > "$fixture/.scratch/work/book.epub"
printf archive > "$fixture/.scratch/unique.zip"
printf report > "$fixture/.scratch/REPORT.md"
mkdir -p "$fixture/.build/rn-ios/derived/Build"
DRY_RUN=1 bash "$prune" --deep-build-cache > "$fixture/dry-run.log"
[[ -d "$fixture/.scratch/old/Shudeng.app" && -d "$fixture/.build/rn-ios/derived" ]]
bash "$prune" --deep-build-cache
before="$(du -sk "$fixture/.build" "$fixture/.scratch")"
bash "$prune" --deep-build-cache
after="$(du -sk "$fixture/.build" "$fixture/.scratch")"
[[ "$before" == "$after" ]]
for config in Debug Release; do
  [[ -d "$artifacts/$config-20260102-000000/app.app" ]]
  [[ ! -e "$artifacts/$config-20260101-000000" ]]
done
[[ -d "$artifacts/parity-preserved/app.app" && -f "$artifacts/Release-20250101-000000/book.epub" ]]
[[ -d "$fixture/.scratch/new/Shudeng.app" && ! -e "$fixture/.scratch/old/Shudeng.app" ]]
[[ -f "$fixture/.scratch/data-before/library.sqlite" && -f "$fixture/.scratch/work/book.epub" ]]
[[ -f "$fixture/.scratch/unique.zip" && -f "$fixture/.scratch/REPORT.md" ]]
[[ -f "$fixture/.scratch/new/Shudeng.app/module-cache/native.dylib" ]]
[[ ! -e "$fixture/.build/rn-ios/derived" && ! -e "$fixture/.scratch/report.xcresult" ]]
[[ ! -e "$fixture/.scratch/profile.trace" && ! -e "$fixture/.scratch/module-cache" ]]
[[ ! -e "$fixture/.scratch/epub-file-port-staging/.build" && ! -e "$fixture/.scratch/epub-file-port-staging/.cache" ]]
mkdir -p "$fixture/.build/rn-ios/tmp-active" "$fixture/.build/rn-ios/derived"
actual=0
bash "$prune" --deep-build-cache > "$fixture/refused.log" 2>&1 || actual=$?
[[ "$actual" == 3 && -d "$fixture/.build/rn-ios/derived" ]]
rmdir "$fixture/.build/rn-ios/tmp-active"
MIN_FREE_GIB=0 MAX_BUILD_GIB=999 bash "$build" Release --no-build
MIN_FREE_GIB=0 MAX_BUILD_GIB=999 bash "$build" Release --no-build
actual=0
MIN_FREE_GIB=0 MAX_BUILD_GIB=999 SIMULATE_FAIL=1 bash "$build" Release --no-build || actual=$?
[[ "$actual" == 1 ]]
shopt -s nullglob
leftovers=("$fixture/.build/rn-ios"/tmp-*)
[[ ${#leftovers[@]} == 0 ]]
printf 'PASS: empty list, dry run, per-config latest app, user data, two rounds, active-build refusal, build failure cleanup\n'
