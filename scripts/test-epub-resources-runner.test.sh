#!/usr/bin/env bash
# Offline preflight/cleanup regression; stubs Swift and never builds the app.
set -euo pipefail
task_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
task_origin="${1:-${SHUDENG_ZIP_SOURCE:-}}"
[[ -d "$task_origin" ]] || { echo "Usage: $0 /path/to/local/ZIPFoundation" >&2; exit 1; }
task_commit=adb49c8bfe060cc187370b12fa081012a6440b86
task_test_root="$task_repo/.build/epub-resources-runner-tests"
mkdir -p "$task_test_root"
task_temp=$(mktemp -d "$task_test_root/tmp-XXXXXX")
trap 'rm -rf -- "$task_temp"' EXIT INT TERM
task_checkout="$task_temp/ZIPFoundation"
git clone --quiet --no-hardlinks --no-checkout -- "$task_origin" "$task_checkout"
git -C "$task_checkout" checkout --quiet --detach "$task_commit"
mkdir "$task_temp/bin"
cat > "$task_temp/bin/swift" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf x >> "$SHUDENG_RUNNER_TEST_MARKER"
[[ -d "$SHUDENG_TEST_TEMP" ]]
printf partial > "$SHUDENG_TEST_TEMP/partial"
exit "${SHUDENG_RUNNER_TEST_EXIT:-0}"
STUB
chmod +x "$task_temp/bin/swift"
task_marker="$task_temp/swift-called"
task_build="$task_temp/build"

run_case() {
  local expected=$1 swift_exit=$2 actual=0
  PATH="$task_temp/bin:$PATH" SHUDENG_ZIP_SOURCE="$task_checkout" \
    SHUDENG_EPUB_TEST_BUILD_DIR="$task_build" SHUDENG_RUNNER_TEST_MARKER="$task_marker" \
    SHUDENG_RUNNER_TEST_EXIT="$swift_exit" "$task_repo/scripts/test-epub-resources.sh" \
    > "$task_temp/runner.log" 2>&1 || actual=$?
  if [[ $actual -ne $expected ]]; then
    cat "$task_temp/runner.log" >&2
    echo "Expected runner exit $expected, received $actual" >&2
    exit 1
  fi
  shopt -s nullglob
  local leftovers=("$task_build"/tmp-*)
  [[ ${#leftovers[@]} -eq 0 ]] || { echo "Runner leaked a temporary directory" >&2; exit 1; }
}

# The same exact-commit clone succeeds twice, including cleanup of partial output.
run_case 0 0
run_case 0 0
[[ $(cat "$task_marker") == xx ]]
rmdir "$task_build"

# A new .swift file is eligible for SwiftPM discovery without changing HEAD.
task_injected=Sources/ZIPFoundation/Injected.swift
printf 'struct Injected {}\n' > "$task_checkout/$task_injected"
run_case 1 0
rg -q 'not clean' "$task_temp/runner.log"
[[ ! -e "$task_build" && $(cat "$task_marker") == xx ]]

# The same compilable file must still be rejected when ordinary status hides it.
printf '/%s\n' "$task_injected" >> "$task_checkout/.git/info/exclude"
[[ -z $(git -C "$task_checkout" status --porcelain=v1 --untracked-files=all) ]]
run_case 1 0
rg -q 'not clean' "$task_temp/runner.log"
[[ ! -e "$task_build" && $(cat "$task_marker") == xx ]]
rm "$task_checkout/$task_injected"

printf '\n// tracked regression edit\n' >> "$task_checkout/Package.swift"
run_case 1 0
rg -q 'not clean' "$task_temp/runner.log"
git -C "$task_checkout" checkout -- Package.swift
git -C "$task_checkout" checkout --quiet --detach HEAD^
run_case 1 0
rg -q 'commit mismatch' "$task_temp/runner.log"
git -C "$task_checkout" checkout --quiet --detach "$task_commit"
[[ ! -e "$task_build" && $(cat "$task_marker") == xx ]]

# A real failure after allocating the runner's temporary directory still cleans it.
run_case 73 73
[[ $(cat "$task_marker") == xxx ]]
rmdir "$task_build"
printf 'PASS: clean clone twice; untracked/ignored/tracked edits and wrong commit rejected; failure cleanup\n'
