#!/usr/bin/env bash
# 清理书灯历史构建/解压/临时副本；只删除可再生产物与重复备份，不碰源码、文档、数据库、密钥。
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN="${DRY_RUN:-0}"
BUILD_ONLY=0
DEEP_BUILD_CACHE=0
for option in "$@"; do
  case "$option" in
    --build-only) BUILD_ONLY=1 ;;
    --deep-build-cache) DEEP_BUILD_CACHE=1 ;;
    *) printf 'usage: %s [--build-only] [--deep-build-cache]\n' "$0" >&2; exit 2 ;;
  esac
done
shopt -s nullglob
deleted=0
remove() {
  local path="$1"
  [[ -e "$path" || -L "$path" ]] || return 0
  if [[ "$DRY_RUN" == "1" ]]; then printf 'WOULD DELETE %s\n' "$path"; else rm -rf -- "$path"; fi
  deleted=$((deleted + 1))
}
log() { printf '[prune] %s\n' "$*"; }

# 显式清理缓存前先检查构建入口是否仍在使用临时目录。
if [[ "$DEEP_BUILD_CACHE" == "1" ]]; then
  active=("$ROOT/.build/rn-ios"/tmp-*)
  if (( ${#active[@]} )); then
    log 'refusing cache cleanup: rn-ios/tmp-* exists; finish the build first' >&2
    exit 3
  fi
fi
# 每个配置只清理完成的、内容仅为 app.app 的旧 artifact；根目录和未知目录保留。
artifact_root="$ROOT/.build/artifacts/rn-ios"
for config in Debug Release; do
  keep=""
  for candidate in "$artifact_root/$config-"*; do
    [[ -d "$candidate/app.app" && ! -L "$candidate" ]] || continue
    [[ "${candidate##*/}" =~ ^(Debug|Release)-[0-9]{8}-[0-9]{6}$ ]] || continue
    contents=("$candidate"/* "$candidate"/.[!.]* "$candidate"/..?*)
    (( ${#contents[@]} == 1 )) || continue
    if [[ -z "$keep" || "$candidate" -nt "$keep" ]]; then keep="$candidate"; fi
  done
  for candidate in "$artifact_root/$config-"*; do
    [[ -d "$candidate/app.app" && ! -L "$candidate" ]] || continue
    [[ "${candidate##*/}" =~ ^(Debug|Release)-[0-9]{8}-[0-9]{6}$ ]] || continue
    [[ "$candidate" == "$keep" ]] && continue
    contents=("$candidate"/* "$candidate"/.[!.]* "$candidate"/..?*)
    if (( ${#contents[@]} == 1 )); then remove "$candidate"; fi
  done
done
if [[ "$DEEP_BUILD_CACHE" == "1" ]]; then remove "$ROOT/.build/rn-ios/derived"; fi
if [[ "$BUILD_ONLY" == "1" ]]; then
  log "build-only deleted=$deleted"
  exit 0
fi

# 仅清理识别明确的 app/xcresult；书籍、数据库、归档和未知目录一律保留。
if [[ -d "$ROOT/.scratch" ]]; then
  # 重复应用备份只保留最新一份 Shudeng.app；其余旧备份/构建产物删除。
  keep_app=""
  while IFS= read -r -d '' path; do
    if [[ -z "$keep_app" || "$path" -nt "$keep_app" ]]; then keep_app="$path"; fi
  done < <(find "$ROOT/.scratch" -type d -name 'Shudeng.app' -prune -print0)
  while IFS= read -r -d '' path; do
    [[ -n "$keep_app" && "$path" == "$keep_app" ]] && continue
    remove "$path"
  done < <(find "$ROOT/.scratch" \
    \( -type d \( -name '*.app' -o -name '*.xcresult' -o -name '*.trace' \) \) \
    -prune -print0 2>/dev/null)
  while IFS= read -r -d '' path; do
    if [[ -d "$path/Build/Intermediates.noindex" && -d "$path/Build/Products" ]]; then
      remove "$path/Build/Intermediates.noindex"
      if [[ "$keep_app" != "$path/Build/Products/"* ]]; then remove "$path/Build/Products"; fi
      remove "$path/ModuleCache.noindex"
      remove "$path/Index.noindex"
    fi
  done < <(find "$ROOT/.scratch" -type d -name '*.app' -prune -o -type d -name 'derived' -prune -print0)
  while IFS= read -r -d '' path; do
    remove "$path"
  done < <(find "$ROOT/.scratch" -type d -name '*.app' -prune -o -type d \( -name 'swift-module-cache' -o -name 'module-cache' \) -prune -print0)
  # 已核对的 Swift 测试 staging：仅清理 SwiftPM 的再生产物。
  if [[ -f "$ROOT/.scratch/epub-file-port-staging/Package.swift" ]]; then
    remove "$ROOT/.scratch/epub-file-port-staging/.build"
    remove "$ROOT/.scratch/epub-file-port-staging/.cache"
  fi
fi

# /private/tmp 中也可能有唯一书籍或持久依赖；未分类项先人工核对，不按名字批量删除。

log "deleted=$deleted free=$(df -Pk "$ROOT" | awk 'NR==2 {printf "%.1fGiB", $4/1024/1024}')"
