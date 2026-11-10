#!/bin/sh
set -eu
app=${1:?Usage: sh scripts/audit-app.sh path/to/Shudeng.app}
if find "$app" -iname '*OpenDyslexic*.otf' -print | rg .; then
  echo 'FAIL: legacy fonts present' >&2; exit 1
fi
if find "$app" -iname '*.epub' -print | rg .; then
  echo 'FAIL: test book present in app' >&2; exit 1
fi
test -s "$app/ThirdPartyNotices.txt"
if test -f "$app/main.jsbundle"; then
  script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  node "$script_dir/package-rn-notices.mjs" --check "$app"
else
  rg -q 'Marcin Krzyzanowski' "$app/ThirdPartyNotices.txt"
  rg -q 'Info-ZIP' "$app/ThirdPartyNotices.txt"
  rg -q 'Apache License' "$app/ThirdPartyNotices.txt"
fi
echo 'PASS: no legacy fonts or EPUB fixtures; notices present'
