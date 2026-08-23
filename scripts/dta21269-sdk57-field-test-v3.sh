#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
V2="$ROOT/scripts/dta21269-sdk57-field-test-v2.sh"
[[ -f "$V2" ]] || { echo "ERROR: v2 field-test script missing" >&2; exit 2; }

resolve_android_sdk() {
  local candidate adb_path adb_real derived

  for candidate in \
    "${ANDROID_HOME:-}" \
    "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" \
    "$HOME/Android/Sdk"
  do
    [[ -n "$candidate" ]] || continue
    if [[ -d "$candidate/build-tools" && -d "$candidate/platforms" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  adb_path="$(command -v adb || true)"
  if [[ -n "$adb_path" ]]; then
    adb_real="$(python3 - "$adb_path" <<'PY'
import os, sys
print(os.path.realpath(sys.argv[1]))
PY
)"
    if [[ "$adb_real" == */platform-tools/adb ]]; then
      derived="${adb_real%/platform-tools/adb}"
      if [[ -d "$derived/build-tools" && -d "$derived/platforms" ]]; then
        printf '%s' "$derived"
        return 0
      fi
    fi
  fi

  return 1
}

SDK="$(resolve_android_sdk || true)"
if [[ -z "$SDK" ]]; then
  echo "ERROR: Android build SDK could not be located." >&2
  echo "ADB may be installed standalone, but this build needs platforms + build-tools." >&2
  exit 26
fi

export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
echo "Android SDK: $ANDROID_HOME"

# local.properties is intentionally local-only and makes the SDK location
# explicit for AGP even if a child Gradle process sanitizes its environment.
python3 - "$ROOT/android-kiosk/local.properties" "$ANDROID_HOME" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
sdk = sys.argv[2].replace('\\', '\\\\').replace(':', '\\:')
p.write_text(f"sdk.dir={sdk}\n", encoding='utf-8')
PY

exec bash "$V2"
