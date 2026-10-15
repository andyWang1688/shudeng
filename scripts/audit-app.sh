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
rg -q 'Marcin Krzyzanowski' "$app/ThirdPartyNotices.txt"
rg -q 'Info-ZIP' "$app/ThirdPartyNotices.txt"
rg -q 'Apache License' "$app/ThirdPartyNotices.txt"
echo 'PASS: no legacy fonts or EPUB fixtures; notices present'
