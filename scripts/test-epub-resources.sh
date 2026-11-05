#!/usr/bin/env bash
# Small standalone ZIP/WK library tests; does not build or install the RN app.
set -euo pipefail
task_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
task_build="${SHUDENG_EPUB_TEST_BUILD_DIR:-$task_repo/.build/epub-resources}"
if [[ -n "${SHUDENG_ZIP_SOURCE:-}" ]]; then
  [[ "$(git -C "$SHUDENG_ZIP_SOURCE" rev-parse HEAD)" == adb49c8bfe060cc187370b12fa081012a6440b86 ]] || { echo "EPUB ZIP dependency commit mismatch" >&2; exit 1; }
  # SwiftPM discovers source files even when Git ignores them. Require a pristine
  # checkout, including untracked/ignored files; never clean the caller's clone.
  task_zip_status=$(git -C "$SHUDENG_ZIP_SOURCE" status --porcelain=v1 --untracked-files=all --ignored=matching)
  [[ -z "$task_zip_status" ]] || { echo "EPUB ZIP test checkout is not clean (tracked, untracked or ignored files); use a fresh clone" >&2; exit 1; }
fi
mkdir -p "$task_build"
task_temp=$(mktemp -d "$task_build/tmp-XXXXXX")
trap 'rm -rf -- "$task_temp"' EXIT INT TERM
export CLANG_MODULE_CACHE_PATH="$task_build/.cache/clang"
export SWIFTPM_MODULECACHE_OVERRIDE="$task_build/.cache/swift"
export SHUDENG_FIXTURE_ROOT="$task_repo/ios/ShudengTests/Fixtures"
export SHUDENG_TEST_TEMP="$task_temp"
swift test --disable-sandbox --package-path "$task_repo/apps/mobile/modules/shudeng-epub" \
  --scratch-path "$task_build" --cache-path "$task_build/.cache/swiftpm"
