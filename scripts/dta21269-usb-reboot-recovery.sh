#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_SDK="5.8.0-test-only"
TARGET_VENDOR_HEX="15a2"
TARGET_PRODUCT_HEX="0101"

fail() { echo "ERROR: $*" >&2; exit 1; }

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$ADB" ]] || fail "adb not found"

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

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

echo "ADB device before reboot: $SERIAL"
echo "ACTION=SAFE_ANDROID_REBOOT"
echo "No payment, ejection, USB reset command, or app-data deletion will be performed."

echo "Rebooting DTA21269 with WisePad left connected..."
"$ADB" -s "$SERIAL" reboot

for _ in $(seq 1 30); do
  if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "Waiting for Android/ADB to return..."
NEW_SERIAL=""
for sec in $(seq 1 240); do
  if "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
    NEW_SERIAL="$SERIAL"
    break
  fi
  candidate="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  if [[ -n "$candidate" ]]; then
    NEW_SERIAL="$candidate"
    break
  fi
  if (( sec % 5 == 0 )); then
    endpoint="$("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | head -1 || true)"
    if [[ -n "$endpoint" ]]; then
      "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
      if "$ADB" -s "$endpoint" get-state >/dev/null 2>&1; then
        NEW_SERIAL="$endpoint"
        break
      fi
    fi
    echo "Waiting for ADB... ${sec}/240s"
  fi
  sleep 1
done

[[ -n "$NEW_SERIAL" ]] || {
  echo "USB_REBOOT_RESULT=ADB_DID_NOT_RETURN"
  echo "Open Wireless debugging on the kiosk and rerun this script; the 5.8 APK remains installed."
  exit 20
}
SERIAL="$NEW_SERIAL"
echo "ADB device after reboot: $SERIAL"
sleep 12

echo "== Kernel USB target check =="
TARGET_PATH=""
for d in /sys/bus/usb/devices/*; do
  vendor="$("$ADB" -s "$SERIAL" shell "cat '$d/idVendor' 2>/dev/null" | tr -d '\r\n' || true)"
  product="$("$ADB" -s "$SERIAL" shell "cat '$d/idProduct' 2>/dev/null" | tr -d '\r\n' || true)"
  vendor_lc="$(lower "$vendor")"
  product_lc="$(lower "$product")"
  if [[ "$vendor_lc" == "$TARGET_VENDOR_HEX" && "$product_lc" == "$TARGET_PRODUCT_HEX" ]]; then
    TARGET_PATH="$d"
    echo "$d ${vendor}:${product}"
    break
  fi
done

if [[ -z "$TARGET_PATH" ]]; then
  echo "USB_REBOOT_RESULT=TARGET_STILL_ABSENT_AFTER_FULL_REBOOT"
  echo "Recent USB kernel messages:"
  "$ADB" -s "$SERIAL" shell dmesg 2>/dev/null \
    | grep -Ei 'usb 2-1\.4|unable to enumerate|device descriptor|not accepting address|error -32|15a2|5538|BBPOS' \
    | tail -80 || true
  exit 21
fi

echo "USB_REBOOT_RESULT=TARGET_ENUMERATED_AFTER_FULL_REBOOT"
"$ADB" -s "$SERIAL" shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true

TMP="$(mktemp -d /tmp/dta21269-usb-reboot.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
READY=0
for attempt in $(seq 1 45); do
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-usb-reboot.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-usb-reboot.xml > "$TMP/window.xml" 2>/dev/null || true
  if python3 - "$TMP/window.xml" "$EXPECTED_SDK" <<'PY'
import json, sys, xml.etree.ElementTree as ET
path, expected = sys.argv[1:]
try:
    root = ET.parse(path).getroot()
except Exception:
    raise SystemExit(2)
payload = None
for node in root.iter('node'):
    text = node.attrib.get('text','')
    if text.startswith('{') and 'stripeTerminalReadiness' in text:
        try:
            payload = json.loads(text)
            break
        except Exception:
            pass
if not payload:
    raise SystemExit(3)
r = payload.get('stripeTerminalReadiness') or {}
d = r.get('diagnostics') or {}
print(json.dumps({
    'readerState': r.get('readerState'),
    'capability': r.get('capability'),
    'stripeSdk': d.get('stripeSdk'),
    'sdkConnectionStatus': d.get('sdkConnectionStatus'),
    'usbPresent': d.get('usbPresent'),
    'usbPermission': d.get('usbPermission'),
    'locationPermission': d.get('locationPermission'),
    'paymentApi': d.get('paymentApi'),
    'errorCode': d.get('errorCode'),
}, separators=(',',':')))
ok = (
    d.get('stripeSdk') == expected and
    d.get('paymentApi') == 'processPaymentIntent' and
    d.get('usbPresent') is True and
    d.get('usbPermission') is True and
    d.get('locationPermission') is True and
    d.get('sdkConnectionStatus') == 'CONNECTED' and
    r.get('readerState') == 'READY' and
    r.get('capability') == 'TERMINAL_AND_QR'
)
raise SystemExit(0 if ok else 4)
PY
  then
    READY=1
    break
  fi
  if (( attempt % 5 == 0 )); then echo "Stripe readiness attempt $attempt/45"; fi
done

if [[ "$READY" == "1" ]]; then
  echo "SDK58_FIELD_READY_PASS"
  echo "USB + Stripe Terminal 5.8 recovered after full Android reboot."
  exit 0
fi

echo "USB_REBOOT_RESULT=USB_PRESENT_BUT_STRIPE_NOT_READY"
"$ADB" -s "$SERIAL" logcat -d -t 500 | grep -E 'ChargeursStripe58|StripeTerminal' | tail -120 || true
exit 22
