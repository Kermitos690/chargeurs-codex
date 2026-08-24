#!/usr/bin/env bash
set -u

PKG="ch.chargeurs.kiosk.staging"
TARGET_STATION="DTA21277"
TARGET_MDNS_SERIAL="${DTA21277_MDNS_SERIAL:-adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb 2>/dev/null || true)"

fail() { echo "SIGNER_GATE_RESULT=ERROR"; echo "ERROR: $*" >&2; exit 1; }
[[ -x "$ADB" ]] || fail "adb not found"

SERIAL="${DTA_SERIAL:-$TARGET_MDNS_SERIAL}"
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  ENDPOINT="$("$ADB" mdns services 2>/dev/null | awk '$1=="adb-3d24b8cbb7d560bc-r6qk3T" && $2=="_adb-tls-connect._tcp" {print $3; exit}')"
  [[ -n "$ENDPOINT" ]] && "$ADB" connect "$ENDPOINT" >/dev/null 2>&1 || true
  if [[ -n "$ENDPOINT" ]] && "$ADB" -s "$ENDPOINT" get-state >/dev/null 2>&1; then SERIAL="$ENDPOINT"; fi
fi
"$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "DTA21277 ADB not responding"

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "ACTION=SIGNER_CONTINUITY_GATE_ONLY"
echo "No install, payment, ejection, reboot, USB reset, app-data change, or vendor-app change will be performed."

STATION="$("$ADB" -s "$SERIAL" shell "run-as '$PKG' cat shared_prefs/chargeurs_kiosk_config.xml 2>/dev/null" 2>/dev/null | tr -d '\r' | sed -n 's/.*<string name="station_id">\([^<]*\)<\/string>.*/\1/p' | head -1)"
echo "DETECTED_STATION_ID=${STATION:-UNKNOWN}"
[[ -z "$STATION" || "$STATION" == "$TARGET_STATION" ]] || fail "selected device is not DTA21277"

TMP="$(mktemp -d /tmp/dta21277-signer-gate.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

BASE_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" 2>/dev/null | tr -d '\r' | sed -n 's/^package://p' | head -1)"
[[ -n "$BASE_PATH" ]] || fail "installed Chargeurs APK path not found"
"$ADB" -s "$SERIAL" pull "$BASE_PATH" "$TMP/installed.apk" >/dev/null 2>&1 || fail "could not pull installed APK"
[[ -s "$TMP/installed.apk" ]] || fail "pulled APK is empty"

APKSIGNER="$(python3 - "$ANDROID_HOME" <<'PY'
from pathlib import Path
import re, sys
root=Path(sys.argv[1])/'build-tools'
candidates=[]
for p in root.glob('*/apksigner'):
    def key(s):
        return tuple(int(x) if x.isdigit() else x for x in re.split(r'(\d+)', s))
    candidates.append((key(p.parent.name), str(p)))
if candidates:
    print(sorted(candidates)[-1][1])
PY
)"
[[ -f "$APKSIGNER" ]] || fail "apksigner not found under $ANDROID_HOME/build-tools"
echo "APKSIGNER=$APKSIGNER"

signer_of() {
  "$APKSIGNER" verify --print-certs "$1" 2>/dev/null \
    | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    | head -1 | tr '[:upper:]' '[:lower:]'
}

INSTALLED_SIGNER="$(signer_of "$TMP/installed.apk")"
[[ -n "$INSTALLED_SIGNER" ]] || fail "could not read installed APK signer"
echo "INSTALLED_APK_SIGNER_SHA256=$INSTALLED_SIGNER"

APK="$ROOT/android-kiosk/app/build/outputs/apk/staging/app-staging.apk"
if [[ ! -s "$APK" ]]; then
  echo "LOCAL_SDK58_APK=NOT_BUILT"
  echo "SIGNER_GATE_RESULT=SDK58_APK_BUILD_REQUIRED"
  exit 2
fi

LOCAL_SIGNER="$(signer_of "$APK")"
[[ -n "$LOCAL_SIGNER" ]] || fail "could not read local 5.8 APK signer"
echo "LOCAL_SDK58_APK=$APK"
echo "LOCAL_SDK58_APK_SIGNER_SHA256=$LOCAL_SIGNER"

VERSION_NAME="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
VERSION_CODE="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
echo "INSTALLED_VERSION_CODE=${VERSION_CODE:-UNKNOWN}"
echo "INSTALLED_VERSION_NAME=${VERSION_NAME:-UNKNOWN}"

if [[ "$INSTALLED_SIGNER" == "$LOCAL_SIGNER" ]]; then
  echo "SIGNER_CONTINUITY=PASS"
  echo "SIGNER_GATE_RESULT=SAFE_FOR_INPLACE_UPDATE_CHECK"
  exit 0
fi

echo "SIGNER_CONTINUITY=FAIL"
echo "SIGNER_GATE_RESULT=DO_NOT_INSTALL_SIGNATURE_MISMATCH"
exit 3
