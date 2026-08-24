#!/usr/bin/env bash
set -u

PKG="ch.chargeurs.kiosk.staging"
TARGET_STATION="DTA21277"
TARGET_MDNS_SERIAL="${DTA21277_MDNS_SERIAL:-adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp}"
TARGET_MDNS_NAME="${DTA21277_MDNS_NAME:-adb-3d24b8cbb7d560bc-r6qk3T}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb 2>/dev/null || true)"

fail() { echo "SIGNER_TRUTH_RESULT=ERROR"; echo "ERROR: $*" >&2; exit 1; }
[[ -x "$ADB" ]] || fail "adb not found"

SERIAL="${DTA_SERIAL:-$TARGET_MDNS_SERIAL}"
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  ENDPOINT="$("$ADB" mdns services 2>/dev/null | awk -v name="$TARGET_MDNS_NAME" '$1==name && $2=="_adb-tls-connect._tcp" {print $3; exit}')"
  [[ -n "$ENDPOINT" ]] && "$ADB" connect "$ENDPOINT" >/dev/null 2>&1 || true
  if [[ -n "$ENDPOINT" ]] && "$ADB" -s "$ENDPOINT" get-state >/dev/null 2>&1; then SERIAL="$ENDPOINT"; fi
fi
"$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "DTA21277 ADB not responding"

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "ACTION=SIGNER_TRUTH_READ_ONLY"
echo "No install, payment, ejection, reboot, USB reset, app-data change, or vendor-app change will be performed."

TMP="$(mktemp -d /tmp/dta21277-signer-truth.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

BASE_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" 2>/dev/null | tr -d '\r' | sed -n 's/^package://p' | head -1)"
echo "INSTALLED_APK_DEVICE_PATH=${BASE_PATH:-NOT_FOUND}"
[[ -n "$BASE_PATH" ]] || fail "installed APK path not found"

"$ADB" -s "$SERIAL" pull "$BASE_PATH" "$TMP/installed.apk" >/dev/null 2>&1
PULL_STATUS=$?
echo "INSTALLED_APK_PULL_STATUS=$PULL_STATUS"
[[ $PULL_STATUS -eq 0 && -s "$TMP/installed.apk" ]] || fail "could not pull installed APK"

BYTES="$(wc -c < "$TMP/installed.apk" | tr -d ' ')"
SHA256="$(shasum -a 256 "$TMP/installed.apk" 2>/dev/null | awk '{print $1}')"
echo "INSTALLED_APK_BYTES=$BYTES"
echo "INSTALLED_APK_FILE_SHA256=${SHA256:-UNAVAILABLE}"

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
[[ -f "$APKSIGNER" ]] || fail "apksigner not found"
echo "APKSIGNER=$APKSIGNER"

run_apksigner() {
  local label="$1"; shift
  local out="$TMP/${label}.out"
  "$APKSIGNER" "$@" >"$out" 2>&1
  local status=$?
  echo "${label}_STATUS=$status"
  echo "== ${label}_OUTPUT =="
  cat "$out"
  echo "== END_${label}_OUTPUT =="
  local digest
  digest="$(grep -Ei 'certificate SHA-256 digest:' "$out" | head -1 | sed 's/.*digest:[[:space:]]*//' | tr '[:upper:]' '[:lower:]' | tr -d '\r')"
  if [[ -n "$digest" ]]; then
    echo "${label}_SIGNER_SHA256=$digest"
    printf '%s' "$digest" > "$TMP/found.digest"
  else
    echo "${label}_SIGNER_SHA256=NOT_FOUND"
  fi
}

run_apksigner APKSIGNER_DEFAULT verify --print-certs --verbose "$TMP/installed.apk"
if [[ ! -s "$TMP/found.digest" ]]; then
  run_apksigner APKSIGNER_MINSDK26 verify --print-certs --verbose --min-sdk-version 26 "$TMP/installed.apk"
fi
if [[ ! -s "$TMP/found.digest" ]]; then
  run_apksigner APKSIGNER_MINSDK21 verify --print-certs --verbose --min-sdk-version 21 "$TMP/installed.apk"
fi

KEYTOOL="$(command -v keytool 2>/dev/null || true)"
echo "KEYTOOL=${KEYTOOL:-NOT_FOUND}"
if [[ ! -s "$TMP/found.digest" && -n "$KEYTOOL" ]]; then
  "$KEYTOOL" -printcert -jarfile "$TMP/installed.apk" >"$TMP/keytool.out" 2>&1
  KEY_STATUS=$?
  echo "KEYTOOL_STATUS=$KEY_STATUS"
  echo "== KEYTOOL_OUTPUT =="
  cat "$TMP/keytool.out"
  echo "== END_KEYTOOL_OUTPUT =="
  KDIGEST="$(grep -E 'SHA256:' "$TMP/keytool.out" | head -1 | sed 's/.*SHA256:[[:space:]]*//' | tr -d ':\r' | tr '[:upper:]' '[:lower:]')"
  if [[ -n "$KDIGEST" ]]; then
    echo "KEYTOOL_SIGNER_SHA256=$KDIGEST"
    printf '%s' "$KDIGEST" > "$TMP/found.digest"
  else
    echo "KEYTOOL_SIGNER_SHA256=NOT_FOUND"
  fi
fi

if [[ -s "$TMP/found.digest" ]]; then
  INSTALLED_SIGNER="$(cat "$TMP/found.digest")"
  echo "INSTALLED_APK_SIGNER_SHA256=$INSTALLED_SIGNER"
else
  echo "INSTALLED_APK_SIGNER_SHA256=UNRESOLVED"
fi

LOCAL_APK="$ROOT/android-kiosk/app/build/outputs/apk/staging/app-staging.apk"
if [[ -s "$LOCAL_APK" ]]; then
  echo "LOCAL_SDK58_APK=$LOCAL_APK"
  "$APKSIGNER" verify --print-certs --verbose "$LOCAL_APK" >"$TMP/local.out" 2>&1
  LOCAL_STATUS=$?
  echo "LOCAL_APKSIGNER_STATUS=$LOCAL_STATUS"
  LOCAL_SIGNER="$(grep -Ei 'certificate SHA-256 digest:' "$TMP/local.out" | head -1 | sed 's/.*digest:[[:space:]]*//' | tr '[:upper:]' '[:lower:]' | tr -d '\r')"
  echo "LOCAL_SDK58_APK_SIGNER_SHA256=${LOCAL_SIGNER:-UNRESOLVED}"
else
  echo "LOCAL_SDK58_APK=NOT_BUILT"
  LOCAL_SIGNER=""
fi

if [[ -s "$TMP/found.digest" && -n "$LOCAL_SIGNER" ]]; then
  INSTALLED_SIGNER="$(cat "$TMP/found.digest")"
  if [[ "$INSTALLED_SIGNER" == "$LOCAL_SIGNER" ]]; then
    echo "SIGNER_CONTINUITY=PASS"
    echo "SIGNER_TRUTH_RESULT=SAFE_FOR_INPLACE_UPDATE_CHECK"
    exit 0
  else
    echo "SIGNER_CONTINUITY=FAIL"
    echo "SIGNER_TRUTH_RESULT=DO_NOT_INSTALL_SIGNATURE_MISMATCH"
    exit 3
  fi
fi

echo "SIGNER_TRUTH_RESULT=NEEDS_INTERPRETATION"
exit 2
