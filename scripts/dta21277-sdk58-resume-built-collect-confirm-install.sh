#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_STATION="DTA21277"
TARGET_DEVICE_PUBLIC_ID="c1651928-082d-4220-a4dc-77e9532ae8a2"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_VERSION_CODE="159"
EXPECTED_VERSION_NAME="1.0.59-terminal-sdk580-collect-confirm-staging"
EXPECTED_SDK="5.8.0-test-only"
EXPECTED_PAYMENT_API="collectPaymentMethod+confirmPaymentIntent"
APK="android-kiosk/app/build/outputs/apk/staging/app-staging.apk"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

JAVA_HOME="${JAVA_HOME:-$HOME/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/jdk-21.0.12.1+1/Contents/Home}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME ANDROID_HOME
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$PATH"

ADB="$ANDROID_HOME/platform-tools/adb"
APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner"

[[ -x "$ADB" ]] || { echo "RESUME_INSTALL_RESULT=FAIL adb_missing"; exit 2; }
[[ -x "$APKSIGNER" ]] || { echo "RESUME_INSTALL_RESULT=FAIL apksigner_missing"; exit 2; }
[[ -f "$APK" ]] || { echo "RESUME_INSTALL_RESULT=FAIL built_apk_missing"; exit 3; }

echo "REFERENCE_STATION=$TARGET_STATION"
echo "ACTION=RESUME_ALREADY_BUILT_SDK58_COLLECT_CONFIRM_INSTALL"
echo "PAYMENT_ACTION=NONE"
echo "HARDWARE_EJECTION_ACTION=NONE"
echo "REBUILD_ACTION=NONE"

# The previous build may have intentionally patched these two tracked files in-place.
# Do not discard them and do not require a clean worktree for this resume-only installer.
if git diff --quiet -- android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java android-kiosk/app/build.gradle.kts; then
  echo "LOCAL_SOURCE_STATE=CLEAN_OR_COMMITTED"
else
  echo "LOCAL_SOURCE_STATE=EXPECTED_FIELD_PATCH_PRESENT"
fi

"$ADB" start-server >/dev/null 2>&1 || true

read_station() {
  local serial="$1"
  "$ADB" -s "$serial" shell "run-as '$PKG' cat shared_prefs/chargeurs_kiosk_config.xml 2>/dev/null" 2>/dev/null \
    | tr -d '\r' \
    | sed -n 's/.*<string name="station_id">\([^<]*\)<\/string>.*/\1/p' \
    | head -1
}

read_device_id() {
  local serial="$1"
  "$ADB" -s "$serial" shell "run-as '$PKG' cat shared_prefs/chargeurs_device_identity.xml 2>/dev/null" 2>/dev/null \
    | tr -d '\r' \
    | sed -n 's/.*<string name="public_id">\([^<]*\)<\/string>.*/\1/p' \
    | head -1
}

refresh_mdns() {
  local services endpoint
  services="$("$ADB" mdns services 2>/dev/null || true)"
  while IFS= read -r endpoint; do
    [[ -n "$endpoint" ]] || continue
    "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
  done < <(printf '%s\n' "$services" | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | sort -u || true)
}

find_target() {
  local serial station device
  while IFS= read -r serial; do
    [[ -n "$serial" ]] || continue
    "$ADB" -s "$serial" get-state >/dev/null 2>&1 || continue
    station="$(read_station "$serial" || true)"
    device="$(read_device_id "$serial" || true)"
    if [[ "$station" == "$TARGET_STATION" || "$device" == "$TARGET_DEVICE_PUBLIC_ID" ]]; then
      printf '%s' "$serial"
      return 0
    fi
  done < <("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')
  return 1
}

SERIAL=""
for attempt in 1 2 3 4 5 6; do
  refresh_mdns
  SERIAL="$(find_target || true)"
  [[ -n "$SERIAL" ]] && break
  sleep 2
done

if [[ -z "$SERIAL" ]]; then
  echo "ADB_DISCOVERY_SERVICES_BEGIN"
  "$ADB" mdns services 2>/dev/null || true
  echo "ADB_DISCOVERY_SERVICES_END"
  echo "ADB_DEVICES_BEGIN"
  "$ADB" devices -l || true
  echo "ADB_DEVICES_END"
  echo "RESUME_INSTALL_RESULT=FAIL dta21277_wireless_adb_not_reachable"
  exit 11
fi

echo "REFERENCE_ADB_SERIAL=$SERIAL"
STATION="$(read_station "$SERIAL" || true)"
DEVICE="$(read_device_id "$SERIAL" || true)"
[[ "$STATION" == "$TARGET_STATION" ]] || { echo "RESUME_INSTALL_RESULT=FAIL wrong_station station=$STATION"; exit 12; }
[[ "$DEVICE" == "$TARGET_DEVICE_PUBLIC_ID" ]] || { echo "RESUME_INSTALL_RESULT=FAIL wrong_device device=$DEVICE"; exit 13; }
echo "DEVICE_IDENTITY=PASS"

USB="$("$ADB" -s "$SERIAL" shell '
for d in /sys/bus/usb/devices/*; do
  [ -f "$d/idVendor" ] || continue
  [ -f "$d/idProduct" ] || continue
  v=$(cat "$d/idVendor" 2>/dev/null | tr "A-Z" "a-z")
  p=$(cat "$d/idProduct" 2>/dev/null | tr "A-Z" "a-z")
  if [ "$v" = "15a2" ] && [ "$p" = "0101" ]; then echo PRESENT; exit 0; fi
done
echo ABSENT
' | tr -d '\r\n')"
[[ "$USB" == "PRESENT" ]] || { echo "RESUME_INSTALL_RESULT=FAIL wisepad_usb_absent"; exit 14; }
echo "WISEPAD_USB=PRESENT"

TMP="$(mktemp -d /tmp/dta21277-resume-install.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
INSTALLED_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" | tr -d '\r' | sed -n 's/^package://p' | head -1)"
[[ -n "$INSTALLED_PATH" ]] || { echo "RESUME_INSTALL_RESULT=FAIL installed_apk_path_missing"; exit 15; }
"$ADB" -s "$SERIAL" pull "$INSTALLED_PATH" "$TMP/installed.apk" >/dev/null
INSTALLED_SIGNER="$($APKSIGNER verify --print-certs "$TMP/installed.apk" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr 'A-F' 'a-f')"
NEW_SIGNER="$($APKSIGNER verify --print-certs "$APK" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr 'A-F' 'a-f')"
[[ -n "$INSTALLED_SIGNER" && "$INSTALLED_SIGNER" == "$NEW_SIGNER" ]] || {
  echo "RESUME_INSTALL_RESULT=FAIL signer_mismatch installed=$INSTALLED_SIGNER new=$NEW_SIGNER"
  exit 16
}
echo "SIGNER_CONTINUITY=PASS"

"$ADB" -s "$SERIAL" install -r "$APK" >"$TMP/install.out" 2>&1 || {
  cat "$TMP/install.out"
  echo "RESUME_INSTALL_RESULT=FAIL adb_install_failed"
  exit 17
}
cat "$TMP/install.out"
echo "APK_UPDATE=PASS"

DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
CODE="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
NAME="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
[[ "$CODE" == "$EXPECTED_VERSION_CODE" && "$NAME" == "$EXPECTED_VERSION_NAME" ]] || {
  echo "RESUME_INSTALL_RESULT=FAIL wrong_installed_version versionCode=$CODE versionName=$NAME"
  exit 18
}
echo "INSTALLED_VERSION=PASS code=$CODE name=$NAME"

"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 1
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 3

LAST=""
for attempt in $(seq 1 45); do
  "$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
  sleep 1
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-resume-install.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-resume-install.xml >"$TMP/window.xml" 2>/dev/null || true
  LAST="$(python3 - "$TMP/window.xml" <<'PY'
import json, sys, xml.etree.ElementTree as ET
try:
    root=ET.parse(sys.argv[1]).getroot()
except Exception:
    raise SystemExit(0)
for node in root.iter('node'):
    text=node.attrib.get('text','')
    if text.startswith('{') and 'stripeTerminalReadiness' in text:
        try: payload=json.loads(text)
        except Exception: continue
        r=payload.get('stripeTerminalReadiness') or {}
        d=r.get('diagnostics') or {}
        out={
            'readerState':r.get('readerState'),
            'capability':r.get('capability'),
            'stripeSdk':d.get('stripeSdk'),
            'paymentApi':d.get('paymentApi'),
            'sdkConnectionStatus':d.get('sdkConnectionStatus'),
            'usbPresent':d.get('usbPresent'),
            'usbPermission':d.get('usbPermission'),
            'errorCode':d.get('errorCode'),
        }
        print(json.dumps(out,separators=(',',':')))
        break
PY
)"
  if [[ -n "$LAST" ]]; then
    echo "READINESS=$LAST"
    if printf '%s' "$LAST" | grep -q '"readerState":"READY"' \
      && printf '%s' "$LAST" | grep -q '"capability":"TERMINAL_AND_QR"' \
      && printf '%s' "$LAST" | grep -q '"stripeSdk":"5.8.0-test-only"' \
      && printf '%s' "$LAST" | grep -q '"paymentApi":"collectPaymentMethod+confirmPaymentIntent"'; then
      echo "RESUME_INSTALL_RESULT=PASS"
      exit 0
    fi
  fi
  sleep 1
done

echo "LAST_READINESS=${LAST:-UNAVAILABLE}"
echo "RESUME_INSTALL_RESULT=INSTALLED_BUT_READER_NOT_READY"
exit 19
