#!/usr/bin/env bash
# 清理书灯历史构建/解压/临时副本；只删除可再生产物与重复备份，不碰源码、文档、数据库、密钥。
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN="${DRY_RUN:-0}"
BUILD_ONLY=0
[[ "${1:-}" == "--build-only" ]] && BUILD_ONLY=1
deleted=0
remove() {
  local path="$1"
  [[ -e "$path" || -L "$path" ]] || return 0
  if [[ "$DRY_RUN" == "1" ]]; then printf 'WOULD DELETE %s\n' "$path"; else rm -rf -- "$path"; fi
  deleted=$((deleted + 1))
}
log() { printf '[prune] %s\n' "$*"; }

# 1) 构建目录和持久 artifact：只保留最新一份 app，限总量。
if [[ -d "$ROOT/.build" ]]; then
  while IFS= read -r -d '' app; do
    # 只清理 rn-ios 的旧 artifact 副本；derived 复用不删。
    :
  done < <(find "$ROOT/.build/artifacts/rn-ios" -maxdepth 1 -type d -name '*-*' -print0 2>/dev/null)
  if [[ -d "$ROOT/.build/artifacts/rn-ios" ]]; then
    while IFS= read -r old; do remove "$old"; done < <(find "$ROOT/.build/artifacts/rn-ios" -maxdepth 1 -type d -name '*-*' -print0 2>/dev/null | xargs -0 ls -dt 2>/dev/null | tail -n +2)
  fi
fi
if [[ "$BUILD_ONLY" == "1" ]]; then
  log "build-only deleted=$deleted"
  exit 0
fi

# 2) 旧 .scratch 验收目录：仅删明显的历史构建/回放/解压目录，保留报告与当前 RN 证据。
HISTORICAL=(
  "$ROOT/.scratch/delivery/first-release-remaining"
  "$ROOT/.scratch/delivery/test-resource-cleanup"
  "$ROOT/.scratch/test-evidence"
  "$ROOT/.scratch/supervision"
  "$ROOT/.scratch/releases"
  "$ROOT/.scratch/impl/release-v041"
  "$ROOT/.scratch/impl/release-v042"
  "$ROOT/.scratch/impl/release-v043"
  "$ROOT/.scratch/impl/release-v044"
  "$ROOT/.scratch/impl/release-v045"
  "$ROOT/.scratch/impl/release-v046"
  "$ROOT/.scratch/impl/release-v047"
  "$ROOT/.scratch/impl/release-v048"
  "$ROOT/.scratch/impl/sys2.xcresult"
  "$ROOT/.scratch/impl/reading-feel"
)
for path in "${HISTORICAL[@]}"; do remove "$path"; done

# 3) .scratch 内重复 app/build/xcresult/大压缩包/视频；保留 md/json/txt/小截图与当前 rn-langchain 证据。
if [[ -d "$ROOT/.scratch" ]]; then
  # 重复应用备份只保留最新一份 Shudeng.app；其余旧备份/构建产物删除。
  keep_app="$(find "$ROOT/.scratch" -type d -name 'Shudeng.app' -print0 2>/dev/null | xargs -0 ls -dt 2>/dev/null | head -1 || true)"
  while IFS= read -r -d '' path; do
    [[ -n "$keep_app" && "$path" == "$keep_app" ]] && continue
    remove "$path"
  done < <(find "$ROOT/.scratch" \
    \( -type d \( -name '*.app' -o -name '*.xcresult' -o -name 'derived' -o -name 'Build' -o -name 'original-app' -o -name 'backup-app' -o -name 'work' -o -name 'data-before' \) \) \
    -prune -print0 2>/dev/null)
  while IFS= read -r -d '' path; do
    remove "$path"
  done < <(find "$ROOT/.scratch" -type f \( -name '*.zip' -o -name '*.ipa' -o -name '*.dylib' -o -name '*.mp4' -o -name '*.mov' -o -size +50M \) -print0 2>/dev/null)
fi

# 4) /private/tmp 中属于本项目的派生产物（先确认路径，不碰其他项目）。
for path in /private/tmp/shudeng-ios-* /private/tmp/Shudeng-v04*-unzip /private/tmp/v04[0-9]zipcheck /private/tmp/shudeng-native-model; do
  remove "$path"
done
find /private/tmp -maxdepth 1 -type f \( -iname '*shudeng*' -o -iname 'ios-*' \) -print0 2>/dev/null \
  | while IFS= read -r -d '' path; do
      if [[ "$DRY_RUN" == "1" ]]; then printf 'WOULD DELETE %s\n' "$path"; else rm -f -- "$path"; fi
    done

log "deleted=$deleted free=$(df -Pk "$ROOT" | awk 'NR==2 {printf "%.1fGiB", $4/1024/1024}')"
