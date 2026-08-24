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
echo "ACTION=LIVE_STRIPE58_RUNTIME_PROBE"
echo "No payment, ejection, reboot, USB reset, reinstall, or app-data deletion will be performed."

TARGET_PRESENT=0
for d in /sys/bus/usb/devices/*; do
  vendor="$("$ADB" -s "$SERIAL" shell "cat '$d/idVendor' 2>/dev/null" | tr -d '\r\n' || true)"
  product="$("$ADB" -s "$SERIAL" shell "cat '$d/idProduct' 2>/dev/null" | tr -d '\r\n' || true)"
  vendor_lc="$(printf '%s' "$vendor" | tr '[:upper:]' '[:lower:]')"
  product_lc="$(printf '%s' "$product" | tr '[:upper:]' '[:lower:]')"
  if [[ "$vendor_lc" == "$TARGET_VENDOR_HEX" && "$product_lc" == "$TARGET_PRODUCT_HEX" ]]; then
    echo "USB_TARGET_PRESENT=$d ${vendor}:${product}"
    TARGET_PRESENT=1
    break
  fi
done
[[ "$TARGET_PRESENT" == "1" ]] || fail "WisePad 15a2:0101 is not currently enumerated; replug it first"

VERSION="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1 | tr -d '\r')"
echo "Installed app: ${VERSION:-unknown}"

# Start from a fresh application process while preserving all app data.
"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" logcat -c >/dev/null 2>&1 || true

START_OUT="$("$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.MainActivity" 2>&1 | tr -d '\r')"
printf '%s\n' "$START_OUT"

echo "Waiting 35s for binding bootstrap + Stripe Terminal initialization/discovery..."
for sec in 5 10 15 20 25 30 35; do
  sleep 5
  echo "Runtime settle... ${sec}/35s"
done

# Open a fresh diagnostic snapshot after the runtime has had longer than its HTTP timeouts.
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
sleep 3
"$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-sdk58-live.xml >/dev/null 2>&1 || true
TMP="$(mktemp -d /tmp/dta21269-sdk58-live.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
"$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-sdk58-live.xml > "$TMP/window.xml" 2>/dev/null || true

python3 - "$TMP/window.xml" "$EXPECTED_SDK" <<'PY'
import json, sys, xml.etree.ElementTree as ET
path, expected = sys.argv[1:]
try:
    root = ET.parse(path).getroot()
except Exception as exc:
    print("LIVE_RUNTIME_RESULT=DIAGNOSTIC_XML_UNAVAILABLE")
    print("detail=" + type(exc).__name__)
    raise SystemExit(10)

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
    print("LIVE_RUNTIME_RESULT=NO_DIAGNOSTIC_SNAPSHOT")
    raise SystemExit(11)

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
    print('LIVE_RUNTIME_RESULT=SDK58_FIELD_READY_PASS')
    raise SystemExit(0)

if d.get('errorCode'):
    print('LIVE_RUNTIME_RESULT=RUNTIME_ERROR')
    raise SystemExit(20)

if d.get('sdkConnectionStatus') == 'NOT_INITIALIZED':
    if not d.get('stripeLocationId'):
        print('LIVE_RUNTIME_RESULT=BINDING_BOOTSTRAP_NOT_COMPLETED')
    else:
        print('LIVE_RUNTIME_RESULT=TERMINAL_INIT_NOT_REACHED_WITH_BINDING_PRESENT')
    raise SystemExit(21)

if d.get('sdkConnectionStatus') in ('DISCOVERING','CONNECTING','RECONNECTING','NOT_CONNECTED'):
    print('LIVE_RUNTIME_RESULT=SDK_STARTED_BUT_READER_NOT_READY')
    raise SystemExit(22)

print('LIVE_RUNTIME_RESULT=UNCLASSIFIED_NOT_READY')
raise SystemExit(23)
PY
STATUS=$?

# Always surface fresh relevant logs without exposing kiosk tokens.
echo "== Fresh Chargeurs / Stripe logs =="
"$ADB" -s "$SERIAL" logcat -d -t 1200 2>/dev/null \
  | grep -E 'ChargeursStripe58|StripeTerminal|TERMINAL_LOCATION|CONNECTION_TOKEN|Terminal reader state' \
  | tail -160 || true

exit "$STATUS"
