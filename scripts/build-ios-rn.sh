#!/usr/bin/env bash
# 书灯 RN/Expo iOS 构建入口：固定复用 .build，失败/中断清理临时产物，限制常驻构建上限。
# 用法：scripts/build-ios-rn.sh [Debug|Release] [--no-build]
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${1:-Release}"
if [[ "$CONFIG" != "Debug" && "$CONFIG" != "Release" ]]; then
  echo "usage: $0 [Debug|Release] [--no-build]" >&2
  exit 2
fi
NO_BUILD="${2:-}"
BUILD_ROOT="$ROOT/.build"
BUILD_DIR="$BUILD_ROOT/rn-ios"
DERIVED="$BUILD_DIR/derived"
TMP="$BUILD_DIR/tmp-$$"
ARTIFACT_ROOT="$BUILD_ROOT/artifacts/rn-ios"
MIN_FREE_GIB="${MIN_FREE_GIB:-30}"
MAX_BUILD_GIB="${MAX_BUILD_GIB:-20}"
MAX_ARTIFACT_GIB="${MAX_ARTIFACT_GIB:-3}"
KEEP_ARTIFACT="${KEEP_ARTIFACT:-0}"

free_gib() { df -Pk "$ROOT" | awk 'NR==2 {printf "%d", $4/1024/1024}'; }
dir_gib() { du -sk "$1" 2>/dev/null | awk '{printf "%d", $1/1024/1024}' || echo 0; }
log() { printf '[build-ios-rn] %s\n' "$*"; }

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  rm -rf "$TMP"
  if [[ $code -ne 0 && "${KEEP_PARTIAL:-0}" != "1" ]]; then
    # 只清理本次未完成的临时/中间产物；derived 保留为可复用缓存。
    rm -rf "$ARTIFACT_ROOT/.partial"
  fi
  log "exit=$code free=$(free_gib)GiB"
  exit "$code"
}
trap cleanup EXIT INT TERM

available="$(free_gib)"
if (( available < MIN_FREE_GIB )); then
  log "可用空间 ${available}GiB < ${MIN_FREE_GIB}GiB，拒绝新增大型构建" >&2
  exit 3
fi
mkdir -p "$DERIVED" "$TMP" "$ARTIFACT_ROOT"
if (( $(dir_gib "$BUILD_ROOT") > MAX_BUILD_GIB )); then
  log ".build 超过 ${MAX_BUILD_GIB}GiB，先清理旧构建与可复用 derived 缓存" >&2
  "$ROOT/scripts/prune-project-artifacts.sh" --build-only
  rm -rf "$DERIVED"
fi
if [[ "${SIMULATE_FAIL:-0}" == "1" ]]; then
  mkdir -p "$TMP/partial"
  touch "$TMP/partial/not-kept"
  log "simulated failure for cleanup verification"
  exit 1
fi
if [[ "$NO_BUILD" == "--no-build" ]]; then
  log "skip xcodebuild (--no-build); derived=$DERIVED"
  exit 0
fi

log "config=$CONFIG free=${available}GiB derived=$DERIVED"
cd "$ROOT/apps/mobile/ios"
xcodebuild \
  -workspace app.xcworkspace \
  -scheme app \
  -configuration "$CONFIG" \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=${IOS_SIMULATOR_UDID:-1B9B9A35-F2D7-4D87-AB31-6B07D1B27D66}" \
  -derivedDataPath "$DERIVED" \
  build

APP="$(find "$DERIVED/Build/Products" -maxdepth 2 -name 'app.app' -type d | head -1)"
if [[ -z "$APP" ]]; then
  log "构建成功但找不到 app.app" >&2
  exit 1
fi
log "app=$APP size=$(du -sh "$APP" | awk '{print $1}')"

if [[ "$KEEP_ARTIFACT" == "1" ]]; then
  mkdir -p "$ARTIFACT_ROOT"
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="$ARTIFACT_ROOT/$CONFIG-$stamp"
  rm -rf "$ARTIFACT_ROOT/.partial"
  mkdir -p "$ARTIFACT_ROOT/.partial"
  ditto "$APP" "$ARTIFACT_ROOT/.partial/app.app"
  mv "$ARTIFACT_ROOT/.partial" "$dest"
  ln -sfn "$dest/app.app" "$ARTIFACT_ROOT/latest.app"
  # 只保留最新一份 artifact，且总量不超过 MAX_ARTIFACT_GIB；重复构建不累积。
  while IFS= read -r old; do rm -rf -- "$old"; done < <(
    find "$ARTIFACT_ROOT" -maxdepth 1 -type d -name "$CONFIG-*" -print0 2>/dev/null       | xargs -0 ls -dt 2>/dev/null | tail -n +2
  )
  while (( $(dir_gib "$ARTIFACT_ROOT") > MAX_ARTIFACT_GIB )); do
    oldest="$(find "$ARTIFACT_ROOT" -maxdepth 1 -type d -name "$CONFIG-*" -print0 2>/dev/null | xargs -0 ls -dt 2>/dev/null | tail -1)"
    [[ -z "$oldest" ]] && break
    rm -rf -- "$oldest"
  done
fi
log "done"
