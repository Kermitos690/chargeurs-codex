#!/usr/bin/env bash
set -euo pipefail

TARGET_STATION="DTA21277"
PKG="ch.chargeurs.kiosk.staging"
TARGET_VENDOR_HEX="15a2"
TARGET_PRODUCT_HEX="0101"

fail() { echo "ERROR: $*" >&2; exit 1; }

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$ADB" ]] || fail "adb not found"

# Refresh any mDNS-discovered wireless-debugging devices without assuming an endpoint.
while IFS= read -r endpoint; do
  [[ -n "$endpoint" ]] || continue
  "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
done < <("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | sort -u || true)

mapfile_compat() {
  # macOS Bash 3.2 compatible replacement for mapfile.
  DEVICES=()
  while IFS= read -r line; do DEVICES+=("$line"); done
}

mapfile_compat < <("$ADB" devices | awk 'NR>1 && $2=="device" {print $1}')
[[ ${#DEVICES[@]} -gt 0 ]] || fail "no ADB device connected yet"

echo "ADB candidates: ${#DEVICES[@]}"
for s in "${DEVICES[@]}"; do echo " - $s"; done

read_station_id() {
  local serial="$1"
  local xml
  xml="$("$ADB" -s "$serial" shell "run-as '$PKG' cat shared_prefs/chargeurs_kiosk_config.xml 2>/dev/null" | tr -d '\r' || true)"
  if [[ -n "$xml" ]]; then
    printf '%s' "$xml" | sed -n 's/.*<string name="station_id">\([^<]*\)<\/string>.*/\1/p' | head -1
  fi
}

SERIAL=""
for s in "${DEVICES[@]}"; do
  station="$(read_station_id "$s")"
  if [[ "$station" == "$TARGET_STATION" ]]; then
    SERIAL="$s"
    break
  fi
done

if [[ -z "$SERIAL" && ${#DEVICES[@]} -eq 1 ]]; then
  SERIAL="${DEVICES[0]}"
  echo "NOTE: only one ADB device is connected; selecting it provisionally."
fi

[[ -n "$SERIAL" ]] || {
  echo "DTA21277_NOT_IDENTIFIED"
  echo "Connected devices and detected station IDs:"
  for s in "${DEVICES[@]}"; do
    station="$(read_station_id "$s")"
    echo " - $s station=${station:-unknown}"
  done
  exit 20
}

"$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "selected ADB device is not responding"

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"

STATION="$(read_station_id "$SERIAL")"
echo "DETECTED_STATION_ID=${STATION:-unknown}"
if [[ -n "$STATION" && "$STATION" != "$TARGET_STATION" ]]; then
  fail "selected device reports station_id=$STATION, expected $TARGET_STATION"
fi

PKG_INFO="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' || true)"
if [[ -z "$PKG_INFO" ]]; then
  echo "CHARGEURS_PACKAGE=NOT_INSTALLED"
else
  VERSION_NAME="$(printf '%s\n' "$PKG_INFO" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
  VERSION_CODE="$(printf '%s\n' "$PKG_INFO" | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -1)"
  echo "CHARGEURS_PACKAGE=$PKG"
  echo "CHARGEURS_VERSION_CODE=${VERSION_CODE:-unknown}"
  echo "CHARGEURS_VERSION_NAME=${VERSION_NAME:-unknown}"
fi

USB_PATH=""
for d in /sys/bus/usb/devices/*; do
  vendor="$("$ADB" -s "$SERIAL" shell "cat '$d/idVendor' 2>/dev/null" | tr -d '\r\n' || true)"
  product="$("$ADB" -s "$SERIAL" shell "cat '$d/idProduct' 2>/dev/null" | tr -d '\r\n' || true)"
  vendor_lc="$(printf '%s' "$vendor" | tr '[:upper:]' '[:lower:]')"
  product_lc="$(printf '%s' "$product" | tr '[:upper:]' '[:lower:]')"
  if [[ "$vendor_lc" == "$TARGET_VENDOR_HEX" && "$product_lc" == "$TARGET_PRODUCT_HEX" ]]; then
    USB_PATH="$d"
    break
  fi
done

if [[ -n "$USB_PATH" ]]; then
  echo "WISEPAD_USB=PRESENT"
  echo "WISEPAD_USB_PATH=$USB_PATH"
else
  echo "WISEPAD_USB=ABSENT"
fi

# Read-only diagnostic snapshot when the installed package exposes it.
if [[ -n "$PKG_INFO" ]]; then
  "$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
  sleep 3
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-dta21277-bootstrap.xml >/dev/null 2>&1 || true
  TMP="$(mktemp -d /tmp/dta21277-bootstrap.XXXXXX)"
  trap 'rm -rf "$TMP"' EXIT
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-dta21277-bootstrap.xml > "$TMP/window.xml" 2>/dev/null || true
  python3 - "$TMP/window.xml" <<'PY' || true
import json, sys, xml.etree.ElementTree as ET
path=sys.argv[1]
try:
    root=ET.parse(path).getroot()
except Exception:
    print('DIAGNOSTIC_SNAPSHOT=UNAVAILABLE')
    raise SystemExit(0)
for node in root.iter('node'):
    text=node.attrib.get('text','')
    if text.startswith('{') and 'stripeTerminalReadiness' in text:
        try:
            payload=json.loads(text)
        except Exception:
            continue
        r=payload.get('stripeTerminalReadiness') or {}
        d=r.get('diagnostics') or {}
        summary={
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
        print('DIAGNOSTIC_SNAPSHOT='+json.dumps(summary,separators=(',',':')))
        raise SystemExit(0)
print('DIAGNOSTIC_SNAPSHOT=NOT_FOUND')
PY
fi

echo "DTA21277_REFERENCE_BOOTSTRAP_DONE"
