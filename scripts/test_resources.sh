#!/bin/sh
# Source from an entry that has already set shudeng_root. No global Python install.
if [ -z "${SHUDENG_TEST_PYTHON:-}" ]; then
  for shudeng_python in "$shudeng_root/.venv/bin/python" \
      "$shudeng_root/venv/bin/python" \
      "$shudeng_root/.build/test-resources/dependencies/python/bin/python" \
      /private/tmp/shudeng-issue11-semantic-adapter-venv/bin/python; do
    if [ -x "$shudeng_python" ]; then
      SHUDENG_TEST_PYTHON=$shudeng_python
      break
    fi
  done
  SHUDENG_TEST_PYTHON=${SHUDENG_TEST_PYTHON:-$(command -v python3)}
fi
export SHUDENG_TEST_PYTHON
if [ "${SHUDENG_TEST_SHELL_MANAGED:-}" != 1 ]; then
  exec "$SHUDENG_TEST_PYTHON" "$shudeng_root/scripts/test_resources.py" shell -- sh "$0" "$@"
fi
shudeng_xcodebuild() {
  "$SHUDENG_TEST_PYTHON" "$shudeng_root/scripts/test_resources.py" xcodebuild "$@"
}
