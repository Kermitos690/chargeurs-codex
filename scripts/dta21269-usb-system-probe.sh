#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$ANDROID_HOME/platform-tools/adb"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$ADB" ]] || { echo "ERROR: adb not found" >&2; exit 2; }

pick_serial() {
  local s endpoint
  s="$("$ADB" devices | awk '$2=="device" && $1 ~ /^[0-9]+\./ {print $1; exit}')"
  [[ -n "$s" ]] || s="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
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
echo "Target WisePad USB: 15a2:0101"
echo
echo "== Android kernel USB devices =="
SYSFS="$($ADB -s "$SERIAL" shell 'for d in /sys/bus/usb/devices/*; do [ -r "$d/idVendor" ] || continue; [ -r "$d/idProduct" ] || continue; v=$(cat "$d/idVendor" 2>/dev/null); p=$(cat "$d/idProduct" 2>/dev/null); printf "%s %s:%s\n" "$d" "$v" "$p"; done' 2>/dev/null | tr -d '\r' || true)"
printf '%s\n' "$SYSFS"
if printf '%s\n' "$SYSFS" | grep -qi '15a2:0101'; then
  KERNEL_PRESENT=1
  echo "KERNEL_USB_TARGET_PRESENT"
else
  KERNEL_PRESENT=0
  echo "KERNEL_USB_TARGET_ABSENT"
fi

echo
echo "== Android USB service (filtered) =="
DUMPSYS="$($ADB -s "$SERIAL" shell dumpsys usb 2>/dev/null | tr -d '\r' || true)"
printf '%s\n' "$DUMPSYS" | grep -Ei '15a2|0101|bbpos|wisepad|UsbDevice|deviceName|vendorId|productId' | head -120 || true
if printf '%s\n' "$DUMPSYS" | grep -Eqi '15a2|vendorId=5538'; then
  SERVICE_PRESENT=1
  echo "ANDROID_USB_SERVICE_TARGET_PRESENT"
else
  SERVICE_PRESENT=0
  echo "ANDROID_USB_SERVICE_TARGET_ABSENT"
fi

echo
echo "== Current Chargeurs diagnostic snapshot =="
PKG="ch.chargeurs.kiosk.staging"
TMP="$(mktemp -d /tmp/dta21269-usb-system-probe.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
sleep 2
"$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-usb-probe.xml >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-usb-probe.xml > "$TMP/window.xml" 2>/dev/null || true
python3 - "$TMP/window.xml" <<'PY'
import json,sys,xml.etree.ElementTree as ET
try: root=ET.parse(sys.argv[1]).getroot()
except Exception:
    print('APP_DIAGNOSTIC_UNAVAILABLE'); raise SystemExit(0)
for n in root.iter('node'):
    t=n.attrib.get('text','')
    if t.startswith('{') and 'stripeTerminalReadiness' in t:
        try:
            p=json.loads(t); r=p.get('stripeTerminalReadiness') or {}; d=r.get('diagnostics') or {}
            print(json.dumps({
                'readerState':r.get('readerState'),
                'capability':r.get('capability'),
                'stripeSdk':d.get('stripeSdk'),
                'usbPresent':d.get('usbPresent'),
                'usbPermission':d.get('usbPermission'),
                'sdkConnectionStatus':d.get('sdkConnectionStatus'),
                'paymentApi':d.get('paymentApi'),
                'errorCode':d.get('errorCode'),
            },separators=(',',':')))
        except Exception: print('APP_DIAGNOSTIC_PARSE_FAILED')
        raise SystemExit(0)
print('APP_DIAGNOSTIC_NOT_FOUND')
PY

echo
if [[ "$KERNEL_PRESENT" == "1" || "$SERVICE_PRESENT" == "1" ]]; then
  echo "USB_CLASSIFICATION=ANDROID_SEES_WISEPAD"
  echo "Next step: app/permission visibility repair; no physical USB action required yet."
else
  echo "USB_CLASSIFICATION=ANDROID_DOES_NOT_SEE_WISEPAD"
  echo "Next step: restore physical USB enumeration first; app code cannot initialize Stripe while the kernel sees no 15a2:0101 device."
fi
