#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BASE="$ROOT/scripts/dta21269-sdk58-inplace-upgrade.sh"
[[ -f "$BASE" ]] || { echo "ERROR: base inplace-upgrade script missing" >&2; exit 2; }

TMP="$(mktemp /tmp/dta21269-sdk58-inplace-v2.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

python3 - "$BASE" "$TMP" <<'PY'
from pathlib import Path
import sys

src = Path(sys.argv[1]).read_text(encoding="utf-8")
out = Path(sys.argv[2])

old = '''BUILD_CONFIG="$(find "$ROOT/android-kiosk/app/build/generated" -type f -path '*/staging/*/ch/chargeurs/kiosk/BuildConfig.java' | head -1 || true)"
[[ -f "$BUILD_CONFIG" ]] || fail "generated staging BuildConfig missing"'''
new = '''BUILD_CONFIG="$(find "$ROOT/android-kiosk/app/build/generated" -type f -name 'BuildConfig.java' -print 2>/dev/null | grep '/staging/' | head -1 || true)"
[[ -f "$BUILD_CONFIG" ]] || {
  echo "Generated BuildConfig candidates:" >&2
  find "$ROOT/android-kiosk/app/build/generated" -type f -name 'BuildConfig.java' -print 2>/dev/null >&2 || true
  fail "generated staging BuildConfig missing"
}
grep -q '^package ch\.chargeurs\.kiosk;' "$BUILD_CONFIG" || fail "wrong generated BuildConfig package"
echo "Staging BuildConfig: $BUILD_CONFIG"'''

if old not in src:
    raise SystemExit("ERROR: expected BuildConfig lookup block not found")
src = src.replace(old, new, 1)
out.write_text(src, encoding="utf-8")
PY

chmod +x "$TMP"
exec bash "$TMP"
