#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_STATION="DTA21277"
TARGET_MDNS="adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_OLD_VERSION="158"
EXPECTED_NEW_VERSION="159"
EXPECTED_NEW_NAME="1.0.59-terminal-sdk580-collect-confirm-staging"
EXPECTED_DEVICE_PUBLIC_ID="c1651928-082d-4220-a4dc-77e9532ae8a2"
EXPECTED_LOCATION="tml_GnoORA0w9yjeut"
EXPECTED_SDK="5.8.0-test-only"
EXPECTED_PAYMENT_API="collectPaymentMethod+confirmPaymentIntent"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

JAVA_HOME="${JAVA_HOME:-$HOME/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/jdk-21.0.12.1+1/Contents/Home}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME ANDROID_HOME
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$PATH"

ADB="$ANDROID_HOME/platform-tools/adb"
APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner"
RUNTIME="android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java"
GRADLE="android-kiosk/app/build.gradle.kts"
APK="android-kiosk/app/build/outputs/apk/staging/app-staging.apk"

fail() { echo "COLLECT_CONFIRM_RESUME_RESULT=FAIL $1"; exit "${2:-2}"; }

[[ -x "$JAVA_HOME/bin/java" ]] || fail java_missing
[[ -x "$ADB" ]] || fail adb_missing
[[ -x "$APKSIGNER" ]] || fail apksigner_missing
[[ -f "$RUNTIME" && -f "$GRADLE" ]] || fail source_missing

# This resume lane is deliberately non-destructive. It accepts dirty tracked
# state only when the dirty paths are exactly the two source files belonging to
# this field fix. Untracked .field-backup/ and FETCH_HEAD are ignored.
mapfile_compat() {
  while IFS= read -r line; do [[ -n "$line" ]] && printf '%s\n' "$line"; done
}
TRACKED_DIRTY="$(git diff --name-only | sort -u | mapfile_compat || true)"
EXPECTED_DIRTY="$(printf '%s\n%s\n' "$GRADLE" "$RUNTIME" | sort -u)"
if [[ -n "$TRACKED_DIRTY" && "$TRACKED_DIRTY" != "$EXPECTED_DIRTY" ]]; then
  echo "Unexpected tracked changes:"
  printf '%s\n' "$TRACKED_DIRTY"
  fail unexpected_tracked_changes 3
fi

git diff --check -- "$RUNTIME" "$GRADLE" || fail source_diff_check_failed 4

# Validate that the local dirty source is exactly on the intended 5.8
# collect+confirm lane before building it. No source rewrite happens here.
grep -Fq '"paymentApi", "collectPaymentMethod+confirmPaymentIntent"' "$RUNTIME" || fail runtime_payment_api_marker_missing 5
grep -Fq 'retrieveAndCollectAndConfirm' "$RUNTIME" || fail runtime_collect_confirm_method_missing 6
grep -Fq 'collectPaymentMethod(' "$RUNTIME" || fail runtime_collect_call_missing 7
grep -Fq 'confirmPaymentIntent(' "$RUNTIME" || fail runtime_confirm_call_missing 8
if grep -Fq '"paymentApi", "processPaymentIntent"' "$RUNTIME"; then fail stale_process_payment_api_marker 9; fi
grep -Fq 'versionCode = if (stagingSimulatedTerminalReaderVersion) 157 else 159' "$GRADLE" || fail version_code_159_marker_missing 10
grep -Fq '"1.0.59-terminal-sdk580-collect-confirm"' "$GRADLE" || fail version_name_159_marker_missing 11

echo "REFERENCE_STATION=$TARGET_STATION"
echo "ACTION=RESUME_VALIDATED_LOCAL_COLLECT_CONFIRM_BUILD_INSTALL"
echo "PAYMENT_ACTION=NONE"
echo "HARDWARE_EJECTION_ACTION=NONE"
echo "LOCAL_SOURCE_VALIDATION=PASS"

echo "BUILD_PHASE=START"
(
  cd android-kiosk
  ./gradlew :app:testDebugUnitTest :app:lintStaging :app:assembleStaging --no-daemon
)
[[ -f "$APK" ]] || fail apk_missing_after_build 12
echo "BUILD_PHASE=PASS"

while IFS= read -r endpoint; do
  [[ -n "$endpoint" ]] || continue
  "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
done < <("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | sort -u || true)

SERIAL="$TARGET_MDNS"
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  SERIAL="$("$ADB" mdns services 2>/dev/null | awk '$1 ~ /^adb-3d24b8cbb7d560bc-r6qk3T/ {print $3; exit}')"
fi
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail dta21277_adb_unavailable 13
echo "REFERENCE_ADB_SERIAL=$SERIAL"

read_pref() {
  local file="$1" key="$2"
  "$ADB" -s "$SERIAL" shell "run-as '$PKG' cat 'shared_prefs/$file.xml' 2>/dev/null" \
    | tr -d '\r' \
    | sed -n "s/.*<string name=\"$key\">\([^<]*\)<\\/string>.*/\1/p" \
    | head -1
}

STATION="$(read_pref chargeurs_kiosk_config station_id || true)"
DEVICE="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$STATION" == "$TARGET_STATION" ]] || fail "wrong_station station=$STATION" 14
[[ "$DEVICE" == "$EXPECTED_DEVICE_PUBLIC_ID" ]] || fail "wrong_device_identity device=$DEVICE" 15
echo "DEVICE_IDENTITY=PASS"

USB="$($ADB -s "$SERIAL" shell '
for d in /sys/bus/usb/devices/*; do
  [ -f "$d/idVendor" ] || continue
  [ -f "$d/idProduct" ] || continue
  v=$(cat "$d/idVendor" 2>/dev/null | tr "A-Z" "a-z")
  p=$(cat "$d/idProduct" 2>/dev/null | tr "A-Z" "a-z")
  if [ "$v" = "15a2" ] && [ "$p" = "0101" ]; then echo PRESENT; exit 0; fi
done
echo ABSENT
' | tr -d '\r\n')"
[[ "$USB" == "PRESENT" ]] || fail wisepad_usb_absent 16
echo "WISEPAD_USB=PRESENT"

DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
OLD_CODE="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
[[ "$OLD_CODE" == "$EXPECTED_OLD_VERSION" || "$OLD_CODE" == "$EXPECTED_NEW_VERSION" ]] || fail "unexpected_installed_version versionCode=$OLD_CODE" 17

TMP="$(mktemp -d /tmp/dta21277-collect-confirm-resume.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
INSTALLED_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" | tr -d '\r' | sed -n 's/^package://p' | head -1)"
[[ -n "$INSTALLED_PATH" ]] || fail installed_apk_path_missing 18
"$ADB" -s "$SERIAL" pull "$INSTALLED_PATH" "$TMP/installed.apk" >/dev/null
INSTALLED_SIGNER="$($APKSIGNER verify --print-certs "$TMP/installed.apk" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr 'A-F' 'a-f')"
NEW_SIGNER="$($APKSIGNER verify --print-certs "$APK" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr 'A-F' 'a-f')"
[[ -n "$INSTALLED_SIGNER" && "$INSTALLED_SIGNER" == "$NEW_SIGNER" ]] || fail "signer_mismatch installed=$INSTALLED_SIGNER new=$NEW_SIGNER" 19
echo "SIGNER_CONTINUITY=PASS"

if [[ "$OLD_CODE" != "$EXPECTED_NEW_VERSION" ]]; then
  INSTALL_OUT="$TMP/install.out"
  "$ADB" -s "$SERIAL" install -r "$APK" >"$INSTALL_OUT" 2>&1 || { cat "$INSTALL_OUT"; fail adb_install_failed 20; }
  cat "$INSTALL_OUT"
  echo "APK_UPDATE=PASS"
else
  echo "APK_UPDATE=ALREADY_INSTALLED"
fi

DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
NEW_CODE="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
NEW_NAME="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
[[ "$NEW_CODE" == "$EXPECTED_NEW_VERSION" && "$NEW_NAME" == "$EXPECTED_NEW_NAME" ]] || fail "wrong_new_apk versionCode=$NEW_CODE versionName=$NEW_NAME" 21

echo "INSTALLED_VERSION=PASS versionCode=$NEW_CODE versionName=$NEW_NAME"

"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 1
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 3

READY=0
LAST=""
for attempt in $(seq 1 45); do
  "$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-dta21277-cc-resume.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-dta21277-cc-resume.xml > "$TMP/window.xml" 2>/dev/null || true
  SUMMARY="$(python3 - "$TMP/window.xml" <<'PY' 2>/dev/null || true
import json, sys, xml.etree.ElementTree as ET
try: root=ET.parse(sys.argv[1]).getroot()
except Exception: raise SystemExit
for node in root.iter('node'):
    text=node.attrib.get('text','')
    if not (text.startswith('{') and 'stripeTerminalReadiness' in text): continue
    try: payload=json.loads(text)
    except Exception: continue
    r=payload.get('stripeTerminalReadiness') or {}; d=r.get('diagnostics') or {}
    print(json.dumps({
      'readerState':r.get('readerState'),'capability':r.get('capability'),
      'stripeSdk':d.get('stripeSdk'),'sdkConnectionStatus':d.get('sdkConnectionStatus'),
      'usbPresent':d.get('usbPresent'),'usbPermission':d.get('usbPermission'),
      'locationPermission':d.get('locationPermission'),'paymentApi':d.get('paymentApi'),
      'stripeReaderSerial':d.get('stripeReaderSerial'),'stripeLocationId':d.get('stripeLocationId'),
      'expectedReaderId':d.get('expectedReaderId'),'errorCode':d.get('errorCode')
    },separators=(',',':'))); break
PY
)"
  [[ -n "$SUMMARY" ]] || continue
  if [[ "$SUMMARY" != "$LAST" ]]; then echo "READINESS=$SUMMARY"; LAST="$SUMMARY"; fi
  if python3 - "$SUMMARY" "$EXPECTED_SDK" "$EXPECTED_PAYMENT_API" "$EXPECTED_LOCATION" <<'PY' >/dev/null 2>&1
import json,sys
s=json.loads(sys.argv[1]); sdk=sys.argv[2]; api=sys.argv[3]; loc=sys.argv[4]
ok=(s.get('readerState')=='READY' and s.get('capability')=='TERMINAL_AND_QR' and
    s.get('stripeSdk')==sdk and s.get('sdkConnectionStatus')=='CONNECTED' and
    s.get('usbPresent') is True and s.get('usbPermission') is True and
    s.get('locationPermission') is True and s.get('paymentApi')==api and
    s.get('stripeLocationId')==loc and s.get('expectedReaderId') in (None,''))
raise SystemExit(0 if ok else 1)
PY
  then READY=1; break; fi
done

if [[ "$READY" == "1" ]]; then
  echo "STRIPE58_COLLECT_CONFIRM_READY=PASS"
  echo "COLLECT_CONFIRM_RESUME_RESULT=PASS"
  echo "No payment or hardware ejection was triggered."
  exit 0
fi

echo "STRIPE58_COLLECT_CONFIRM_READY=FAIL"
echo "LAST_READINESS=${LAST:-none}"
"$ADB" -s "$SERIAL" logcat -d -t 500 | grep -E 'ChargeursStripe58|StripeTerminal' | tail -120 || true
fail reader_not_ready 22
