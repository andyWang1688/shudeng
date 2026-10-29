#!/usr/bin/env bash
# 渲染书灯视觉系统预览的证据截图。
# 依赖：macOS + Google Chrome（headless）。不联网，只读本地 HTML。
# 用法：bash docs/design/2026-10-27/visual-system/render.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
OUT="$HERE/evidence"
HTML="$HERE/visual-system.html"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$REPO/.build/design-chrome-profile"
CRASH="$REPO/.build/design-chrome-crash"

if [ ! -x "$CHROME" ]; then
  echo "未找到 Google Chrome：$CHROME" >&2
  exit 1
fi
mkdir -p "$OUT" "$PROFILE" "$CRASH"

shoot() { # $1=输出名 $2=宽 $3=高 $4=scale $5=query
  "$CHROME" --headless=new --no-sandbox --disable-setuid-sandbox \
    --disable-gpu --in-process-gpu --disable-dev-shm-usage \
    --hide-scrollbars --no-first-run --no-default-browser-check \
    --disable-breakpad --disable-crash-reporter --noerrdialogs \
    --crash-dumps-dir="$CRASH" --user-data-dir="$PROFILE" \
    --force-device-scale-factor="$4" --window-size="$2,$3" \
    --screenshot="$OUT/$1" "file://$HTML?$5" >/dev/null 2>&1
  echo "  $1"
}

echo "渲染视觉系统证据 …"
shoot board-light-375.png 1260 1600 1.5 "board=light375"
shoot board-dark-375.png  1260 1600 1.5 "board=dark375"
shoot board-light-390.png 1300 1060 1.5 "board=light390"
shoot icons.png           1200 560  2   "board=icons"
shoot specimen-p1.png     1260 2400 1.5 "board=specimen&part=p1"
shoot specimen-p2.png     1260 2000 1.5 "board=specimen&part=p2"
shoot specimen-p3.png     1260 2500 1.5 "board=specimen&part=p3"

shoot shelf-light-375@2x.png   375 667 2 "solo=shelf&theme=light&w=375&h=667"
shoot notes-light-375@2x.png   375 667 2 "solo=notes&theme=light&w=375&h=667"
shoot chats-light-375@2x.png   375 667 2 "solo=chats&theme=light&w=375&h=667"
shoot profile-light-375@2x.png 375 667 2 "solo=profile&theme=light&w=375&h=667"
shoot reader-light-390@2x.png  390 844 2 "solo=reader&theme=light&w=390&h=844"
shoot ask-light-375@2x.png     375 667 2 "solo=ask&theme=light&w=375&h=667"
shoot shelf-dark-375@2x.png    375 667 2 "solo=shelf&theme=dark&w=375&h=667"
shoot ask-dark-375@2x.png      375 667 2 "solo=ask&theme=dark&w=375&h=667"
shoot reader-dark-390@2x.png   390 844 2 "solo=reader&theme=dark&w=390&h=844"

echo "完成：$OUT"
