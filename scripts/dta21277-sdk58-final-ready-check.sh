#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_STATION="DTA21277"
TARGET_MDNS="adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_VERSION_CODE="158"
EXPECTED_VERSION_NAME="1.0.58-terminal-sdk580-process-reconnect-staging"
EXPECTED_SDK="5.8.0-test-only"
EXPECTED_DEVICE_PUBLIC_ID="c1651928-082d-4220-a4dc-77e9532ae8a2"

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
[[ -x "$ADB" ]] || { echo "FINAL_READY_RESULT=FAIL adb_not_found"; exit 2; }

while IFS= read -r endpoint; do
  [[ -n "$endpoint" ]] || continue
  "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
done < <("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | sort -u || true)

SERIAL="$TARGET_MDNS"
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  SERIAL="$("$ADB" mdns services 2>/dev/null | awk '$1 ~ /^adb-3d24b8cbb7d560bc-r6qk3T/ {print $3; exit}')"
fi
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || { echo "FINAL_READY_RESULT=FAIL dta21277_adb_unavailable"; exit 3; }

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "ACTION=RESTART_AND_VERIFY_AFTER_USB_MOBILE_READER_BINDING_FIX"
echo "PAYMENT_ACTION=NONE"
echo "HARDWARE_EJECTION_ACTION=NONE"

read_pref() {
  local file="$1" key="$2"
  "$ADB" -s "$SERIAL" shell "run-as '$PKG' cat 'shared_prefs/$file.xml' 2>/dev/null" \
    | tr -d '\r' \
    | sed -n "s/.*<string name=\"$key\">\([^<]*\)<\\/string>.*/\1/p" \
    | head -1
}

DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
CODE="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
NAME="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
[[ "$CODE" == "$EXPECTED_VERSION_CODE" && "$NAME" == "$EXPECTED_VERSION_NAME" ]] || {
  echo "FINAL_READY_RESULT=FAIL wrong_apk versionCode=$CODE versionName=$NAME"
  exit 4
}

STATION="$(read_pref chargeurs_kiosk_config station_id || true)"
DEVICE="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$STATION" == "$TARGET_STATION" ]] || { echo "FINAL_READY_RESULT=FAIL wrong_station station=$STATION"; exit 5; }
[[ "$DEVICE" == "$EXPECTED_DEVICE_PUBLIC_ID" ]] || { echo "FINAL_READY_RESULT=FAIL wrong_device_identity device=$DEVICE"; exit 6; }

echo "APK_BINDING_PRECHECK=PASS"

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
[[ "$USB" == "PRESENT" ]] || { echo "FINAL_READY_RESULT=FAIL wisepad_usb_absent"; exit 7; }
echo "WISEPAD_USB=PRESENT"

# Restart only the Chargeurs staging app so it refetches the corrected backend
# binding (USB mobile readers are location-bound, not server reader-ID-bound).
"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 1
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 3

TMP="$(mktemp -d /tmp/dta21277-final-ready.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
READY=0
LAST=""
for attempt in $(seq 1 45); do
  "$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-dta21277-final-ready.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-dta21277-final-ready.xml > "$TMP/window.xml" 2>/dev/null || true
  SUMMARY="$(python3 - "$TMP/window.xml" <<'PY' 2>/dev/null || true
import json, sys, xml.etree.ElementTree as ET
try:
    root=ET.parse(sys.argv[1]).getroot()
except Exception:
    raise SystemExit
for node in root.iter('node'):
    text=node.attrib.get('text','')
    if not (text.startswith('{') and 'stripeTerminalReadiness' in text):
        continue
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
        'stripeReaderId':d.get('stripeReaderId'),
        'stripeReaderSerial':d.get('stripeReaderSerial'),
        'discoveredReaderId':d.get('discoveredReaderId'),
        'discoveredReaderSerial':d.get('discoveredReaderSerial'),
        'stripeLocationId':d.get('stripeLocationId'),
        'expectedReaderId':d.get('expectedReaderId'),
        'errorCode':d.get('errorCode'),
    }, separators=(',',':')))
    break
PY
)"
  [[ -n "$SUMMARY" ]] || continue
  if [[ "$SUMMARY" != "$LAST" ]]; then echo "READINESS=$SUMMARY"; LAST="$SUMMARY"; fi
  if python3 - "$SUMMARY" "$EXPECTED_SDK" <<'PY' >/dev/null 2>&1
import json,sys
s=json.loads(sys.argv[1]); expected=sys.argv[2]
ok=(s.get('readerState')=='READY' and s.get('capability')=='TERMINAL_AND_QR' and
    s.get('stripeSdk')==expected and s.get('sdkConnectionStatus')=='CONNECTED' and
    s.get('usbPresent') is True and s.get('usbPermission') is True and
    s.get('locationPermission') is True and s.get('paymentApi')=='processPaymentIntent' and
    s.get('stripeLocationId')=='tml_GnoORA0w9yjeut' and s.get('expectedReaderId') in (None,''))
raise SystemExit(0 if ok else 1)
PY
  then READY=1; break; fi
done

if [[ "$READY" == "1" ]]; then
  echo "STRIPE58_READY=PASS"
  echo "FINAL_READY_RESULT=PASS"
  echo "No payment or hardware ejection was triggered."
  exit 0
fi

echo "STRIPE58_READY=FAIL"
echo "LAST_READINESS=${LAST:-none}"
"$ADB" -s "$SERIAL" logcat -d -t 500 | grep -E 'ChargeursStripe58|StripeTerminal' | tail -120 || true
echo "FINAL_READY_RESULT=FAIL reader_not_ready"
exit 21
