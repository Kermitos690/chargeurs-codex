#!/usr/bin/env bash
set -euo pipefail

PKG="ch.chargeurs.kiosk.staging"
TARGET_VENDOR_HEX="15a2"
TARGET_PRODUCT_HEX="0101"
EXPECTED_SDK="5.8.0-test-only"

fail() { echo "ERROR: $*" >&2; exit 1; }

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$ADB" ]] || fail "adb not found"

pick_serial() {
  local s endpoint
  s="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  if [[ -z "$s" ]]; then
    endpoint="$("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | head -1 || true)"
    if [[ -n "$endpoint" ]]; then
      "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
      "$ADB" -s "$endpoint" get-state >/dev/null 2>&1 && s="$endpoint"
    fi
  fi
  printf '%s' "$s"
}

SERIAL="${DTA_SERIAL:-$(pick_serial)}"
[[ -n "$SERIAL" ]] || fail "DTA21269 ADB not connected"
"$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "DTA21269 ADB not responding"

echo "ADB device: $SERIAL"
echo "ACTION=REPLUG_THEN_IMMEDIATE_STRIPE58_CAPTURE"
echo "No payment, ejection, reboot, reinstall, USB reset, or app-data deletion will be performed."
echo
echo "Disconnect and reconnect only the accessible WisePad USB cable now."
echo "Waiting up to 120s for 15a2:0101..."

find_target() {
  local d vendor product vendor_lc product_lc
  for d in /sys/bus/usb/devices/*; do
    vendor="$("$ADB" -s "$SERIAL" shell "cat '$d/idVendor' 2>/dev/null" | tr -d '\r\n' || true)"
    product="$("$ADB" -s "$SERIAL" shell "cat '$d/idProduct' 2>/dev/null" | tr -d '\r\n' || true)"
    vendor_lc="$(printf '%s' "$vendor" | tr '[:upper:]' '[:lower:]')"
    product_lc="$(printf '%s' "$product" | tr '[:upper:]' '[:lower:]')"
    if [[ "$vendor_lc" == "$TARGET_VENDOR_HEX" && "$product_lc" == "$TARGET_PRODUCT_HEX" ]]; then
      printf '%s' "$d"
      return 0
    fi
  done
  return 1
}

TARGET_PATH=""
for sec in $(seq 1 120); do
  TARGET_PATH="$(find_target || true)"
  if [[ -n "$TARGET_PATH" ]]; then
    echo "USB_TARGET_REAPPEARED=$TARGET_PATH"
    break
  fi
  if (( sec % 10 == 0 )); then echo "Waiting for USB enumeration... ${sec}/120s"; fi
  sleep 1
done

if [[ -z "$TARGET_PATH" ]]; then
  echo "LIVE_CAPTURE_RESULT=TARGET_STILL_ABSENT"
  "$ADB" -s "$SERIAL" shell dmesg 2>/dev/null \
    | grep -Ei 'usb 2-1\.4|unable to enumerate|device descriptor|not accepting address|error -32|15a2|5538|BBPOS' \
    | tail -80 || true
  exit 20
fi

# Start Stripe runtime immediately while USB is known-present.
"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" logcat -c >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.MainActivity" >/dev/null 2>&1 || true

echo "Chargeurs process restarted immediately after enumeration."

DROPPED=0
for sec in $(seq 1 35); do
  if [[ -z "$(find_target || true)" ]]; then
    echo "USB_DROPPED_AFTER_ENUMERATION_AT=${sec}s"
    DROPPED=1
    break
  fi
  if (( sec % 5 == 0 )); then echo "Runtime settle with USB present... ${sec}/35s"; fi
  sleep 1
done

if [[ "$DROPPED" == "1" ]]; then
  echo "LIVE_CAPTURE_RESULT=USB_UNSTABLE_DROPPED_AFTER_ENUMERATION"
  "$ADB" -s "$SERIAL" shell dmesg 2>/dev/null \
    | grep -Ei 'usb 2-1\.4|disconnect|unable to enumerate|device descriptor|not accepting address|error -32|15a2|5538|BBPOS' \
    | tail -100 || true
  echo "== Fresh Chargeurs / Stripe logs =="
  "$ADB" -s "$SERIAL" logcat -d -t 1200 2>/dev/null \
    | grep -E 'ChargeursStripe58|StripeTerminal|TERMINAL_LOCATION|CONNECTION_TOKEN|Terminal reader state' \
    | tail -160 || true
  exit 21
fi

# Take a brand-new diagnostic snapshot only after runtime settle.
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
sleep 3
"$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-sdk58-live-capture.xml >/dev/null 2>&1 || true
TMP="$(mktemp -d /tmp/dta21269-sdk58-capture.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
"$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-sdk58-live-capture.xml > "$TMP/window.xml" 2>/dev/null || true

set +e
python3 - "$TMP/window.xml" "$EXPECTED_SDK" <<'PY'
import json, sys, xml.etree.ElementTree as ET
path, expected = sys.argv[1:]
try:
    root = ET.parse(path).getroot()
except Exception as exc:
    print('LIVE_CAPTURE_RESULT=DIAGNOSTIC_XML_UNAVAILABLE')
    print('detail=' + type(exc).__name__)
    raise SystemExit(30)

payload = None
for node in root.iter('node'):
    text = node.attrib.get('text', '')
    if text.startswith('{') and 'stripeTerminalReadiness' in text:
        try:
            payload = json.loads(text)
            break
        except Exception:
            pass

if not payload:
    print('LIVE_CAPTURE_RESULT=NO_DIAGNOSTIC_SNAPSHOT')
    raise SystemExit(31)

r = payload.get('stripeTerminalReadiness') or {}
d = r.get('diagnostics') or {}
summary = {
    'readerState': r.get('readerState'),
    'capability': r.get('capability'),
    'stripeSdk': d.get('stripeSdk'),
    'sdkConnectionStatus': d.get('sdkConnectionStatus'),
    'usbPresent': d.get('usbPresent'),
    'usbPermission': d.get('usbPermission'),
    'locationPermission': d.get('locationPermission'),
    'paymentApi': d.get('paymentApi'),
    'stripeLocationId': d.get('stripeLocationId'),
    'expectedReaderId': d.get('expectedReaderId'),
    'stripeReaderId': d.get('stripeReaderId'),
    'discoveredReaderId': d.get('discoveredReaderId'),
    'discoveryRunning': d.get('discoveryRunning'),
    'connectionRunning': d.get('connectionRunning'),
    'errorCode': d.get('errorCode'),
}
print('LIVE_DIAGNOSTIC=' + json.dumps(summary, separators=(',', ':')))

ready = (
    d.get('stripeSdk') == expected and
    d.get('paymentApi') == 'processPaymentIntent' and
    d.get('usbPresent') is True and
    d.get('usbPermission') is True and
    d.get('locationPermission') is True and
    d.get('sdkConnectionStatus') == 'CONNECTED' and
    r.get('readerState') == 'READY' and
    r.get('capability') == 'TERMINAL_AND_QR'
)
if ready:
    print('LIVE_CAPTURE_RESULT=SDK58_FIELD_READY_PASS')
    raise SystemExit(0)
if d.get('errorCode'):
    print('LIVE_CAPTURE_RESULT=RUNTIME_ERROR')
    raise SystemExit(40)
if d.get('sdkConnectionStatus') == 'NOT_INITIALIZED':
    if not d.get('stripeLocationId'):
        print('LIVE_CAPTURE_RESULT=BINDING_BOOTSTRAP_NOT_COMPLETED')
    else:
        print('LIVE_CAPTURE_RESULT=TERMINAL_INIT_NOT_REACHED_WITH_BINDING_PRESENT')
    raise SystemExit(41)
print('LIVE_CAPTURE_RESULT=SDK_STARTED_BUT_READER_NOT_READY')
raise SystemExit(42)
PY
STATUS=$?
set -e

echo "== Fresh Chargeurs / Stripe logs =="
"$ADB" -s "$SERIAL" logcat -d -t 1200 2>/dev/null \
  | grep -E 'ChargeursStripe58|StripeTerminal|TERMINAL_LOCATION|CONNECTION_TOKEN|Terminal reader state' \
  | tail -160 || true

exit "$STATUS"
