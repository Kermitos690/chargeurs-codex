#!/usr/bin/env bash
set -Eeuo pipefail

EXPECTED_BRANCH="fix/dta21269-terminal-sdk-5-7"
TARGET_STATION="DTA21277"
TARGET_MDNS="adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_OLD_VERSION_CODE="129"
EXPECTED_OLD_SIGNER="b37d4cda37c8623259dfc7aa408328b8f2d04911082c46073b6e1b429ba805a3"
EXPECTED_DEVICE_PUBLIC_ID="c1651928-082d-4220-a4dc-77e9532ae8a2"
EXPECTED_NEW_VERSION_CODE="158"
EXPECTED_NEW_VERSION_NAME="1.0.58-terminal-sdk580-process-reconnect-staging"
EXPECTED_NEW_SIGNER="1e4d4c12ec3b21a3ff7186fb7bdcf4097f13b0a8d7a6b6fc7ba7dbebd92042f6"
EXPECTED_SDK="5.8.0-test-only"
PAIRING_CODE="${PAIRING_CODE:-${1:-}}"
ROOT="$(git rev-parse --show-toplevel)"

fail() { echo "FINAL_MIGRATION_RESULT=FAIL"; echo "ERROR: $*" >&2; exit 1; }

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

refresh_adb
SERIAL="$TARGET_MDNS"
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  SERIAL="$("$ADB" mdns services 2>/dev/null | awk '$1 ~ /^adb-3d24b8cbb7d560bc-r6qk3T/ {print $3; exit}')"
fi
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "DTA21277 ADB unavailable"

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "ACTION=ONE_SHOT_SDK58_SIGNER_MIGRATION"
echo "HARDWARE_EJECTION_ENABLED=false"
echo "PAYMENT_ACTION=NONE"

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

# ---------- Preflight: absolutely no destructive action before every gate passes ----------
STATION_ID="$(read_pref chargeurs_kiosk_config station_id || true)"
[[ "$STATION_ID" == "$TARGET_STATION" ]] || fail "device is not enrolled as DTA21277 (found: ${STATION_ID:-none})"

DEVICE_PUBLIC_ID="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$DEVICE_PUBLIC_ID" == "$EXPECTED_DEVICE_PUBLIC_ID" ]] || fail "unexpected DTA21277 device_public_id: ${DEVICE_PUBLIC_ID:-none}"

PKG_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
OLD_CODE="$(printf '%s\n' "$PKG_DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
OLD_NAME="$(printf '%s\n' "$PKG_DUMP" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
[[ "$OLD_CODE" == "$EXPECTED_OLD_VERSION_CODE" ]] || fail "unexpected installed versionCode=$OLD_CODE"

echo "OLD_VERSION_CODE=$OLD_CODE"
echo "OLD_VERSION_NAME=$OLD_NAME"
echo "DEVICE_PUBLIC_ID=$DEVICE_PUBLIC_ID"

[[ "$(remote_usb_present)" == "PRESENT" ]] || fail "WisePad 15a2:0101 is not live on DTA21277"
echo "WISEPAD_USB_BEFORE=PRESENT"

BACKUP_DIR="$ROOT/.field-backup/dta21277-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
OLD_APK_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" | head -1 | sed 's/^package://' | tr -d '\r')"
[[ -n "$OLD_APK_PATH" ]] || fail "installed APK path unavailable"
"$ADB" -s "$SERIAL" pull "$OLD_APK_PATH" "$BACKUP_DIR/old-base.apk" >/dev/null
OLD_SIGNER="$(cert_sha "$BACKUP_DIR/old-base.apk")"
[[ "$OLD_SIGNER" == "$EXPECTED_OLD_SIGNER" ]] || fail "old signer mismatch: $OLD_SIGNER"
"$ADB" -s "$SERIAL" shell "run-as '$PKG' cat shared_prefs/chargeurs_kiosk_config.xml" > "$BACKUP_DIR/chargeurs_kiosk_config.xml"
"$ADB" -s "$SERIAL" shell "run-as '$PKG' cat shared_prefs/chargeurs_device_identity.xml" > "$BACKUP_DIR/chargeurs_device_identity.xml"
chmod 600 "$BACKUP_DIR"/*.xml

echo "BACKUP_DIR=$BACKUP_DIR"
echo "OLD_SIGNER=$OLD_SIGNER"

# Build current 5.8 staging APK before removing the working app.
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ROOT/android-kiosk/local.properties"
unset CHARGEURS_STAGING_KEYSTORE_PATH CHARGEURS_STAGING_KEYSTORE_PASSWORD CHARGEURS_STAGING_KEY_ALIAS CHARGEURS_STAGING_KEY_PASSWORD || true
(
  cd "$ROOT/android-kiosk"
  ./gradlew --no-daemon --console=plain :app:assembleStaging
)
APK="$ROOT/android-kiosk/app/build/outputs/apk/staging/app-staging.apk"
[[ -f "$APK" ]] || fail "5.8 staging APK was not produced"
BADGING="$($AAPT dump badging "$APK" | head -1)"
printf '%s\n' "$BADGING" | grep -q "package: name='$PKG'" || fail "new APK package mismatch"
printf '%s\n' "$BADGING" | grep -q "versionCode='$EXPECTED_NEW_VERSION_CODE'" || fail "new APK versionCode mismatch"
printf '%s\n' "$BADGING" | grep -q "versionName='$EXPECTED_NEW_VERSION_NAME'" || fail "new APK versionName mismatch"
NEW_SIGNER="$(cert_sha "$APK")"
[[ "$NEW_SIGNER" == "$EXPECTED_NEW_SIGNER" ]] || fail "new APK signer mismatch: $NEW_SIGNER"

grep -q 'HARDWARE_EJECTION_ENABLED", "false"' "$ROOT/android-kiosk/app/build.gradle.kts" || fail "hardware ejection build gate missing"
grep -q 'com.stripe:stripeterminal:5.8.0' "$ROOT/android-kiosk/app/build.gradle.kts" || fail "Stripe Terminal 5.8 dependency missing"
grep -q 'processPaymentIntent' "$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java" || fail "processPaymentIntent implementation missing"
grep -q 'StagingMigrationEnrollmentActivity' "$ROOT/android-kiosk/app/src/main/AndroidManifest.xml" || fail "migration activity missing from manifest"

echo "NEW_APK_SIGNER=$NEW_SIGNER"
echo "BUILD_GATE=PASS"

# ---------- Signer migration ----------
echo "MIGRATION_PHASE=REPLACE_APK"
"$ADB" -s "$SERIAL" uninstall "$PKG" >/dev/null || fail "old APK uninstall failed"
if ! "$ADB" -s "$SERIAL" install "$APK" >/dev/null; then
  echo "NEW_INSTALL=FAIL"
  "$ADB" -s "$SERIAL" install "$BACKUP_DIR/old-base.apk" >/dev/null 2>&1 || true
  fail "new APK install failed; old APK reinstall was attempted"
fi

echo "NEW_INSTALL=PASS"
"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell "run-as '$PKG' mkdir -p shared_prefs" >/dev/null

# Preserve only the non-secret stable device UUID. The old encrypted kiosk token
# is signer-bound and must NOT be copied into the new signer context.
DEVICE_XML="<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name=\"public_id\">$DEVICE_PUBLIC_ID</string>
</map>"
printf '%s\n' "$DEVICE_XML" | "$ADB" -s "$SERIAL" shell "run-as '$PKG' sh -c 'cat > shared_prefs/chargeurs_device_identity.xml && chmod 600 shared_prefs/chargeurs_device_identity.xml'"
RESTORED_ID="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$RESTORED_ID" == "$DEVICE_PUBLIC_ID" ]] || fail "device_public_id restore failed"
echo "DEVICE_IDENTITY_RESTORE=PASS"

"$ADB" -s "$SERIAL" shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
[[ "$(remote_usb_present)" == "PRESENT" ]] || fail "WisePad disappeared during APK replacement"
echo "WISEPAD_USB_AFTER_INSTALL=PRESENT"

# Start the non-exported migration helper as the app UID. From this point the
# one-time code can be consumed and the backend token may rotate, so no blind
# rollback to the old encrypted token is attempted.
echo "MIGRATION_PHASE=REENROLL"
START_OUT="$("$ADB" -s "$SERIAL" shell "run-as '$PKG' am start -W -n '$PKG/ch.chargeurs.kiosk.StagingMigrationEnrollmentActivity' --es pairing_code '$PAIRING_CODE' --es expected_station_id '$TARGET_STATION' --es expected_device_public_id '$DEVICE_PUBLIC_ID'" 2>&1 | tr -d '\r' || true)"
printf '%s\n' "$START_OUT"
printf '%s\n' "$START_OUT" | grep -qE 'Status: ok|Starting: Intent' || fail "migration Activity could not be started"

MIGRATION_RESULT=""
for _ in $(seq 1 45); do
  sleep 2
  XML="$("$ADB" -s "$SERIAL" shell "run-as '$PKG' cat shared_prefs/chargeurs_migration_result.xml 2>/dev/null" | tr -d '\r' || true)"
  MIGRATION_RESULT="$(printf '%s' "$XML" | sed -n 's/.*<string name="result">\([^<]*\)<\/string>.*/\1/p' | head -1)"
  [[ -n "$MIGRATION_RESULT" ]] && break
done
[[ -n "$MIGRATION_RESULT" ]] || fail "migration result timed out"
echo "APP_MIGRATION_RESULT=$MIGRATION_RESULT"
printf '%s' "$MIGRATION_RESULT" | grep -q '^PASS ' || {
  "$ADB" -s "$SERIAL" logcat -d -t 350 | grep -E 'ChargeursMigration|ChargeursStripe58' | tail -100 || true
  fail "re-enrollment failed: $MIGRATION_RESULT"
}

# ---------- Final verification ----------
FINAL_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
printf '%s\n' "$FINAL_DUMP" | grep -q "versionCode=$EXPECTED_NEW_VERSION_CODE" || fail "final versionCode mismatch"
printf '%s\n' "$FINAL_DUMP" | grep -q "versionName=$EXPECTED_NEW_VERSION_NAME" || fail "final versionName mismatch"
FINAL_STATION="$(read_pref chargeurs_kiosk_config station_id || true)"
[[ "$FINAL_STATION" == "$TARGET_STATION" ]] || fail "final station binding missing"
FINAL_ID="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$FINAL_ID" == "$EXPECTED_DEVICE_PUBLIC_ID" ]] || fail "final device identity changed"
[[ "$(remote_usb_present)" == "PRESENT" ]] || fail "WisePad USB not present after migration"

echo "MIGRATION_PHASE=STRIPE58_READINESS"
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
TMP="$(mktemp -d /tmp/dta21277-sdk58-final.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
READY=0
LAST_SUMMARY=""
for attempt in $(seq 1 45); do
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-dta21277-sdk58-final.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-dta21277-sdk58-final.xml > "$TMP/window.xml" 2>/dev/null || true
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
        }, separators=(',',':')))
        break
PY
)"
  [[ -n "$SUMMARY" ]] || continue
  LAST_SUMMARY="$SUMMARY"
  if python3 - "$SUMMARY" "$EXPECTED_SDK" <<'PY'
import json,sys
s=json.loads(sys.argv[1]); expected=sys.argv[2]
ok=(s.get('readerState')=='READY' and s.get('capability')=='TERMINAL_AND_QR' and
    s.get('stripeSdk')==expected and s.get('sdkConnectionStatus')=='CONNECTED' and
    s.get('usbPresent') is True and s.get('usbPermission') is True and
    s.get('locationPermission') is True and s.get('paymentApi')=='processPaymentIntent')
raise SystemExit(0 if ok else 1)
PY
  then
    READY=1
    break
  fi
  (( attempt % 5 == 0 )) && echo "READINESS_WAIT=$attempt/45 $SUMMARY"
done

echo "FINAL_DIAGNOSTIC=${LAST_SUMMARY:-NOT_FOUND}"
if [[ "$READY" != "1" ]]; then
  "$ADB" -s "$SERIAL" logcat -d -t 600 | grep -E 'ChargeursStripe58|StripeTerminal|ChargeursMigration' | tail -160 || true
  fail "Stripe 5.8 did not reach READY/CONNECTED"
fi

echo "FINAL_VERSION=$EXPECTED_NEW_VERSION_NAME"
echo "FINAL_STATION=$FINAL_STATION"
echo "FINAL_DEVICE_PUBLIC_ID=$FINAL_ID"
echo "FINAL_WISEPAD_USB=PRESENT"
echo "FINAL_STRIPE_SDK=$EXPECTED_SDK"
echo "FINAL_PAYMENT_API=processPaymentIntent"
echo "FINAL_READER_STATE=READY"
echo "FINAL_CAPABILITY=TERMINAL_AND_QR"
echo "PAYMENT_ACTION=NONE"
echo "EJECTION_ACTION=NONE"
echo "FINAL_MIGRATION_RESULT=PASS"
