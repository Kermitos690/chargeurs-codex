#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_BRANCH="fix/dta21269-terminal-sdk-5-7"
TARGET_STATION="DTA21277"
TARGET_MDNS="adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_DEVICE_PUBLIC_ID="c1651928-082d-4220-a4dc-77e9532ae8a2"
EXPECTED_VERSION_CODE="158"
EXPECTED_VERSION_NAME="1.0.58-terminal-sdk580-process-reconnect-staging"
EXPECTED_SIGNER="1e4d4c12ec3b21a3ff7186fb7bdcf4097f13b0a8d7a6b6fc7ba7dbebd92042f6"
EXPECTED_SDK="5.8.0-test-only"
PAIRING_CODE="${PAIRING_CODE:-${1:-}}"
ROOT="$(git rev-parse --show-toplevel)"

fail() { echo "RESUME_MIGRATION_RESULT=FAIL"; echo "ERROR: $*" >&2; exit 1; }
[[ "$PAIRING_CODE" =~ ^[0-9]{6}$ ]] || fail "PAIRING_CODE must be the fresh six-digit DTA21277 code"
[[ "$(git -C "$ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "wrong branch"

resolve_java_home() {
  local c
  for c in \
    "${JAVA_HOME:-}" \
    "$HOME/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/jdk-21.0.12.1+1/Contents/Home" \
    "$HOME/Library/Caches/chargeurs-jdk/temurin21-aarch64/unpack/jdk-21.0.12.1+1/Contents/Home" \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  do
    [[ -n "$c" && -x "$c/bin/java" ]] || continue
    printf '%s' "$c"
    return 0
  done
  return 1
}

JAVA_HOME="$(resolve_java_home || true)"
[[ -n "$JAVA_HOME" ]] || fail "JDK 17+ not found"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
ADB="$ANDROID_HOME/platform-tools/adb"
APKSIGNER="$(find "$ANDROID_HOME/build-tools" -type f -name apksigner -perm -u+x 2>/dev/null | sort -V | tail -1)"
AAPT="$(find "$ANDROID_HOME/build-tools" -type f -name aapt -perm -u+x 2>/dev/null | sort -V | tail -1)"
[[ -x "$ADB" && -x "$APKSIGNER" && -x "$AAPT" ]] || fail "Android SDK/build tools unavailable"

cert_sha() {
  "$APKSIGNER" verify --print-certs "$1" 2>/dev/null \
    | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    | head -1 | tr '[:upper:]' '[:lower:]' | tr -d ':'
}

refresh_adb() {
  while IFS= read -r endpoint; do
    [[ -n "$endpoint" ]] || continue
    "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
  done < <("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | sort -u || true)
}

read_pref() {
  local file="$1" key="$2"
  "$ADB" -s "$SERIAL" shell "run-as '$PKG' cat 'shared_prefs/$file.xml' 2>/dev/null" \
    | tr -d '\r' \
    | sed -n "s/.*<string name=\"$key\">\([^<]*\)<\\/string>.*/\1/p" \
    | head -1
}

remote_usb_present() {
  "$ADB" -s "$SERIAL" shell '
    for d in /sys/bus/usb/devices/*; do
      [ -f "$d/idVendor" ] || continue
      [ -f "$d/idProduct" ] || continue
      v=$(cat "$d/idVendor" 2>/dev/null | tr "A-Z" "a-z")
      p=$(cat "$d/idProduct" 2>/dev/null | tr "A-Z" "a-z")
      if [ "$v" = "15a2" ] && [ "$p" = "0101" ]; then
        echo PRESENT
        exit 0
      fi
    done
    echo ABSENT
  ' | tr -d '\r\n'
}

refresh_adb
SERIAL="$TARGET_MDNS"
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  SERIAL="$("$ADB" mdns services 2>/dev/null | awk '$1 ~ /^adb-3d24b8cbb7d560bc-r6qk3T/ {print $3; exit}')"
fi
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "DTA21277 ADB unavailable"

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "ACTION=RESUME_AFTER_SUCCESSFUL_SIGNER_REPLACEMENT"
echo "PAYMENT_ACTION=NONE"
echo "HARDWARE_EJECTION_ENABLED=false"

PKG_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
CODE="$(printf '%s\n' "$PKG_DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
NAME="$(printf '%s\n' "$PKG_DUMP" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
[[ "$CODE" == "$EXPECTED_VERSION_CODE" ]] || fail "expected already-migrated versionCode 158, found ${CODE:-none}"
[[ "$NAME" == "$EXPECTED_VERSION_NAME" ]] || fail "unexpected installed versionName=$NAME"
CURRENT_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" | head -1 | sed 's/^package://' | tr -d '\r')"
TMP="$(mktemp -d /tmp/dta21277-sdk58-resume.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
"$ADB" -s "$SERIAL" pull "$CURRENT_PATH" "$TMP/current.apk" >/dev/null
CURRENT_SIGNER="$(cert_sha "$TMP/current.apk")"
[[ "$CURRENT_SIGNER" == "$EXPECTED_SIGNER" ]] || fail "installed 5.8 signer mismatch: $CURRENT_SIGNER"
DEVICE_PUBLIC_ID="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$DEVICE_PUBLIC_ID" == "$EXPECTED_DEVICE_PUBLIC_ID" ]] || fail "device_public_id was not preserved"
[[ "$(remote_usb_present)" == "PRESENT" ]] || fail "WisePad 15a2:0101 is not live"
echo "INSTALLED_SDK58_BASE=PASS"
echo "DEVICE_IDENTITY=PASS"
echo "WISEPAD_USB=PRESENT"

# Build the corrected staging APK. Same package, version and signer; install -r
# only updates the staging manifest so ADB shell can invoke the migration helper.
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ROOT/android-kiosk/local.properties"
unset CHARGEURS_STAGING_KEYSTORE_PATH CHARGEURS_STAGING_KEYSTORE_PASSWORD CHARGEURS_STAGING_KEY_ALIAS CHARGEURS_STAGING_KEY_PASSWORD || true
(
  cd "$ROOT/android-kiosk"
  ./gradlew --no-daemon --console=plain :app:assembleStaging
)
APK="$ROOT/android-kiosk/app/build/outputs/apk/staging/app-staging.apk"
[[ -f "$APK" ]] || fail "corrected staging APK not produced"
BADGING="$($AAPT dump badging "$APK" | head -1)"
printf '%s\n' "$BADGING" | grep -q "package: name='$PKG'" || fail "package mismatch"
printf '%s\n' "$BADGING" | grep -q "versionCode='$EXPECTED_VERSION_CODE'" || fail "versionCode mismatch"
printf '%s\n' "$BADGING" | grep -q "versionName='$EXPECTED_VERSION_NAME'" || fail "versionName mismatch"
NEW_SIGNER="$(cert_sha "$APK")"
[[ "$NEW_SIGNER" == "$EXPECTED_SIGNER" ]] || fail "corrected APK signer mismatch: $NEW_SIGNER"
MANIFEST_DUMP="$($AAPT dump xmltree "$APK" AndroidManifest.xml 2>/dev/null || true)"
printf '%s\n' "$MANIFEST_DUMP" | grep -q 'StagingMigrationEnrollmentActivity' || fail "staging migration Activity missing"
printf '%s\n' "$MANIFEST_DUMP" | grep -q 'android.permission.DUMP' || fail "staging migration Activity shell permission missing"
echo "CORRECTED_BUILD_GATE=PASS"

"$ADB" -s "$SERIAL" install -r "$APK" >/dev/null || fail "same-signer staging manifest update failed"
RESTORED_ID="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$RESTORED_ID" == "$EXPECTED_DEVICE_PUBLIC_ID" ]] || fail "device identity changed after install -r"
echo "CORRECTED_APK_UPDATE=PASS"

# Direct shell invocation is intentional: the Activity is staging-only and
# protected by android.permission.DUMP, which is available to ADB shell but not
# ordinary third-party apps.
"$ADB" -s "$SERIAL" shell "run-as '$PKG' rm -f shared_prefs/chargeurs_migration_result.xml" >/dev/null 2>&1 || true
echo "MIGRATION_PHASE=REENROLL"
START_OUT="$("$ADB" -s "$SERIAL" shell am start -W -n "$PKG/ch.chargeurs.kiosk.StagingMigrationEnrollmentActivity" --es pairing_code "$PAIRING_CODE" --es expected_station_id "$TARGET_STATION" --es expected_device_public_id "$EXPECTED_DEVICE_PUBLIC_ID" 2>&1 | tr -d '\r' || true)"
printf '%s\n' "$START_OUT"
printf '%s\n' "$START_OUT" | grep -q 'Status: ok' || {
  printf '%s\n' "$START_OUT" | grep -q 'Error: Activity not started' && fail "migration Activity start rejected"
  printf '%s\n' "$START_OUT" | grep -q 'SecurityException' && fail "migration Activity shell permission rejected"
}

MIGRATION_RESULT=""
for _ in $(seq 1 45); do
  sleep 2
  XML="$("$ADB" -s "$SERIAL" shell "run-as '$PKG' cat shared_prefs/chargeurs_migration_result.xml 2>/dev/null" | tr -d '\r' || true)"
  MIGRATION_RESULT="$(printf '%s' "$XML" | sed -n 's/.*<string name="result">\([^<]*\)<\/string>.*/\1/p' | head -1)"
  [[ -n "$MIGRATION_RESULT" ]] && break
done
[[ -n "$MIGRATION_RESULT" ]] || fail "re-enrollment result timed out"
echo "APP_MIGRATION_RESULT=$MIGRATION_RESULT"
printf '%s' "$MIGRATION_RESULT" | grep -q '^PASS ' || {
  "$ADB" -s "$SERIAL" logcat -d -t 350 | grep -E 'ChargeursMigration|ChargeursStripe58' | tail -120 || true
  fail "re-enrollment failed: $MIGRATION_RESULT"
}

FINAL_STATION="$(read_pref chargeurs_kiosk_config station_id || true)"
FINAL_ID="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$FINAL_STATION" == "$TARGET_STATION" ]] || fail "final DTA21277 config missing"
[[ "$FINAL_ID" == "$EXPECTED_DEVICE_PUBLIC_ID" ]] || fail "final device identity changed"
[[ "$(remote_usb_present)" == "PRESENT" ]] || fail "WisePad disappeared after enrollment"
echo "REENROLLMENT=PASS"

# Let MainActivity/native bridge own the reader for a short bounded period,
# then take fresh diagnostic snapshots. No payment is initiated.
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 8
READY=0
LAST_SUMMARY=""
for attempt in $(seq 1 12); do
  "$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-dta21277-sdk58-resume.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-dta21277-sdk58-resume.xml > "$TMP/window.xml" 2>/dev/null || true
  SUMMARY="$(python3 - "$TMP/window.xml" <<'PY' 2>/dev/null || true
import json, sys, xml.etree.ElementTree as ET
try:
    root=ET.parse(sys.argv[1]).getroot()
except Exception:
    raise SystemExit
for node in root.iter('node'):
    text=node.attrib.get('text','')
    if text.startswith('{') and 'stripeTerminalReadiness' in text:
        try: payload=json.loads(text)
        except Exception: continue
        r=payload.get('stripeTerminalReadiness') or {}
        d=r.get('diagnostics') or {}
        print(json.dumps({
            'readerState':r.get('readerState'),
            'capability':r.get('capability'),
            'stripeSdk':d.get('stripeSdk'),
            'sdkConnectionStatus':d.get('sdkConnectionStatus'),
            'usbPresent':d.get('usbPresent'),
            'usbPermission':d.get('usbPermission'),
            'locationPermission':d.get('locationPermission'),
            'paymentApi':d.get('paymentApi'),
            'errorCode':d.get('errorCode'),
        },separators=(',',':')))
        break
PY
)"
  [[ -n "$SUMMARY" ]] && LAST_SUMMARY="$SUMMARY" && echo "READINESS=$SUMMARY"
  if [[ -n "$SUMMARY" ]] && python3 - "$SUMMARY" "$EXPECTED_SDK" <<'PY'
import json, sys
s=json.loads(sys.argv[1]); expected=sys.argv[2]
ok=(s.get('stripeSdk')==expected and s.get('paymentApi')=='processPaymentIntent' and
    s.get('usbPresent') is True and s.get('usbPermission') is True and
    s.get('locationPermission') is True and s.get('readerState')=='READY' and
    s.get('capability')=='TERMINAL_AND_QR' and s.get('sdkConnectionStatus')=='CONNECTED')
raise SystemExit(0 if ok else 1)
PY
  then
    READY=1
    break
  fi
  sleep 3
done

if [[ "$READY" == "1" ]]; then
  echo "STRIPE58_READINESS=PASS"
  echo "RESUME_MIGRATION_RESULT=PASS"
  echo "FINAL_STATION=$FINAL_STATION"
  echo "FINAL_DEVICE_PUBLIC_ID=$FINAL_ID"
  echo "FINAL_VERSION=$EXPECTED_VERSION_NAME"
  echo "FINAL_SIGNER=$EXPECTED_SIGNER"
  echo "No payment or battery ejection was triggered."
  exit 0
fi

echo "STRIPE58_READINESS=NOT_READY"
echo "LAST_READINESS=${LAST_SUMMARY:-UNAVAILABLE}"
"$ADB" -s "$SERIAL" logcat -d -t 500 | grep -E 'ChargeursStripe58|StripeTerminal|ChargeursMigration' | tail -140 || true
echo "RESUME_MIGRATION_RESULT=REENROLL_PASS_READER_NOT_READY"
exit 22
