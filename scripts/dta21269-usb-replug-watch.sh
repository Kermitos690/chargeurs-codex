#!/usr/bin/env bash
set -euo pipefail

PKG="ch.chargeurs.kiosk.staging"
EXPECTED_VID="15a2"
EXPECTED_PID="0101"
EXPECTED_SDK="5.8.0-test-only"
ROOT="$(git rev-parse --show-toplevel)"

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
ADB="$(command -v adb || true)"
[[ -n "$ADB" ]] || ADB="$ANDROID_HOME/platform-tools/adb"
[[ -x "$ADB" ]] || { echo "ERROR: adb not found" >&2; exit 2; }

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
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || {
  echo "ERROR: DTA21269 ADB not connected" >&2
  exit 3
}

echo "ADB device: $SERIAL"
echo "WATCH_MODE=READ_ONLY_UNTIL_TARGET_APPEARS"
echo "Target WisePad: ${EXPECTED_VID}:${EXPECTED_PID}"
echo
echo "Now disconnect and reconnect only the accessible USB cable of the WisePad 3."
echo "Do not open the kiosk or touch internal wiring. This watcher will wait up to 120 seconds."

kernel_has_target() {
  "$ADB" -s "$SERIAL" shell 'for d in /sys/bus/usb/devices/*; do [ -f "$d/idVendor" ] || continue; [ -f "$d/idProduct" ] || continue; v=$(cat "$d/idVendor" 2>/dev/null | tr "A-F" "a-f"); p=$(cat "$d/idProduct" 2>/dev/null | tr "A-F" "a-f"); if [ "$v:$p" = "15a2:0101" ]; then echo "$d"; exit 0; fi; done; exit 1' 2>/dev/null | tr -d '\r'
}

TARGET_PATH=""
for i in $(seq 1 60); do
  TARGET_PATH="$(kernel_has_target || true)"
  if [[ -n "$TARGET_PATH" ]]; then
    echo "KERNEL_TARGET_REAPPEARED=$TARGET_PATH"
    break
  fi
  if (( i % 5 == 0 )); then
    echo "Waiting for USB enumeration... $((i*2))/120s"
  fi
  sleep 2
done

if [[ -z "$TARGET_PATH" ]]; then
  echo "USB_REPLUG_RESULT=TARGET_STILL_ABSENT"
  echo "Recent USB kernel messages:"
  "$ADB" -s "$SERIAL" shell dmesg 2>/dev/null \
    | grep -Ei 'usb 2-1\.4|unable to enumerate|device descriptor|not accepting address|power cycle|15a2|BBPOS' \
    | tail -60 || true
  exit 20
fi

# Once Android has a real 15a2:0101 device again, open only the non-financial
# diagnostic activity so the existing runtime can request/observe its normal
# USB permission and Stripe connection lifecycle. No payment/ejection methods
# are called by this script.
echo "Opening Chargeurs hardware diagnostics only..."
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
sleep 2

echo "If Android shows a USB permission dialog for the WisePad, tap Allow once."
TMP="$(mktemp -d /tmp/dta21269-usb-replug-watch.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
READY=0
for i in $(seq 1 45); do
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-usb-replug.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-usb-replug.xml > "$TMP/window.xml" 2>/dev/null || true
  STATUS="$(python3 - "$TMP/window.xml" "$EXPECTED_SDK" <<'PY' || true
import json, sys, xml.etree.ElementTree as ET
path, expected = sys.argv[1:]
try:
    root = ET.parse(path).getroot()
except Exception:
    print('NO_SNAPSHOT')
    raise SystemExit
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
    print('NO_SNAPSHOT')
    raise SystemExit
r = payload.get('stripeTerminalReadiness') or {}
d = r.get('diagnostics') or {}
out = {
    'readerState': r.get('readerState'),
    'capability': r.get('capability'),
    'stripeSdk': d.get('stripeSdk'),
    'sdkConnectionStatus': d.get('sdkConnectionStatus'),
    'usbPresent': d.get('usbPresent'),
    'usbPermission': d.get('usbPermission'),
    'locationPermission': d.get('locationPermission'),
    'paymentApi': d.get('paymentApi'),
    'errorCode': d.get('errorCode'),
}
print(json.dumps(out, separators=(',',':')))
PY
)"
  echo "diagnostic: $STATUS"
  if python3 - "$STATUS" "$EXPECTED_SDK" <<'PY' >/dev/null 2>&1
import json,sys
try: d=json.loads(sys.argv[1])
except Exception: raise SystemExit(1)
expected=sys.argv[2]
ok=(d.get('stripeSdk')==expected and d.get('paymentApi')=='processPaymentIntent' and d.get('usbPresent') is True and d.get('usbPermission') is True and d.get('readerState')=='READY' and d.get('capability')=='TERMINAL_AND_QR' and d.get('sdkConnectionStatus')=='CONNECTED')
raise SystemExit(0 if ok else 1)
PY
  then
    READY=1
    break
  fi
  sleep 2
done

if [[ "$READY" == "1" ]]; then
  echo "USB_REPLUG_RESULT=SDK58_READY"
  echo "SDK58_FIELD_READY_PASS"
  echo "No payment or battery ejection was triggered."
  exit 0
fi

echo "USB_REPLUG_RESULT=USB_PRESENT_BUT_STRIPE_NOT_READY"
echo "Recent Chargeurs/Stripe logs:"
"$ADB" -s "$SERIAL" logcat -d -t 400 2>/dev/null \
  | grep -E 'ChargeursStripe58|StripeTerminal|UsbHostManager|UsbPermission' \
  | tail -100 || true
exit 21
