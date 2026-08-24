#!/usr/bin/env bash
set -u

PKG="ch.chargeurs.kiosk.staging"
VENDOR_PKG="com.szbjkj.bajietouchpower"
TARGET_STATION="DTA21277"
TARGET_MDNS_SERIAL="${DTA21277_MDNS_SERIAL:-adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp}"
TARGET_MDNS_NAME="${DTA21277_MDNS_NAME:-adb-3d24b8cbb7d560bc-r6qk3T}"
TARGET_VENDOR="15a2"
TARGET_PRODUCT="0101"

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb 2>/dev/null || true)"
if [[ ! -x "$ADB" ]]; then
  echo "ERROR: adb not found"
  exit 1
fi

serial_live() {
  "$ADB" -s "$1" get-state >/dev/null 2>&1
}

SERIAL="${DTA_SERIAL:-}"
if [[ -z "$SERIAL" ]] && serial_live "$TARGET_MDNS_SERIAL"; then
  SERIAL="$TARGET_MDNS_SERIAL"
fi
if [[ -z "$SERIAL" ]]; then
  ENDPOINT="$("$ADB" mdns services 2>/dev/null | awk -v n="$TARGET_MDNS_NAME" '$1==n && $2=="_adb-tls-connect._tcp" {print $3; exit}')"
  if [[ -n "$ENDPOINT" ]]; then
    "$ADB" connect "$ENDPOINT" >/dev/null 2>&1 || true
    if serial_live "$ENDPOINT"; then SERIAL="$ENDPOINT"; fi
  fi
fi
if [[ -z "$SERIAL" ]]; then
  echo "ERROR: DTA21277 ADB identity is not reachable"
  "$ADB" devices -l || true
  "$ADB" mdns services 2>/dev/null || true
  exit 2
fi

STATION="$("$ADB" -s "$SERIAL" shell "run-as '$PKG' cat shared_prefs/chargeurs_kiosk_config.xml 2>/dev/null" 2>/dev/null | tr -d '\r' | sed -n 's/.*<string name="station_id">\([^<]*\)<\/string>.*/\1/p' | head -1)"

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "DETECTED_STATION_ID=${STATION:-UNKNOWN}"
echo "ACTION=ANDROID_SIDE_USB_TRUTH"
echo "No payment, ejection, reboot, install, USB reset, permission grant, force-stop, or app-data change will be performed."

echo "== Android-side live sysfs USB inventory =="
USB_INVENTORY="$("$ADB" -s "$SERIAL" shell '
for d in /sys/bus/usb/devices/*; do
  [ -r "$d/idVendor" ] || continue
  [ -r "$d/idProduct" ] || continue
  v=$(cat "$d/idVendor" 2>/dev/null)
  p=$(cat "$d/idProduct" 2>/dev/null)
  m=$(cat "$d/manufacturer" 2>/dev/null)
  n=$(cat "$d/product" 2>/dev/null)
  printf "%s %s:%s manufacturer=%s product=%s\n" "$d" "$v" "$p" "$m" "$n"
done
' 2>/dev/null | tr -d '\r')"
printf '%s\n' "$USB_INVENTORY"

TARGET_LINE="$(printf '%s\n' "$USB_INVENTORY" | awk 'tolower($2)=="15a2:0101" {print; exit}')"
if [[ -n "$TARGET_LINE" ]]; then
  echo "WISEPAD_USB=PRESENT"
  echo "WISEPAD_SYSFS_LINE=$TARGET_LINE"
else
  echo "WISEPAD_USB=ABSENT"
fi

echo "== Android USB host manager current state =="
USB_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys usb 2>/dev/null | tr -d '\r')"
printf '%s\n' "$USB_DUMP" | grep -Ei -C 7 'name=/dev/bus/usb|vendor_id=5538|product_id=257|BBPOS|WPC323211052352|package_name=com.szbjkj.bajietouchpower|package_name=ch.chargeurs.kiosk.staging' | tail -180 || true

if printf '%s\n' "$USB_DUMP" | grep -Eq 'vendor_id=5538' && printf '%s\n' "$USB_DUMP" | grep -Eq 'product_id=257'; then
  echo "ANDROID_USB_HOST_RECORD=BBPOS_PRESENT_IN_DUMPSYS"
else
  echo "ANDROID_USB_HOST_RECORD=BBPOS_NOT_PRESENT_IN_DUMPSYS"
fi

if printf '%s\n' "$USB_DUMP" | grep -q 'package_name=com.szbjkj.bajietouchpower'; then
  echo "USB_DEFAULT_HANDLER=BAJIETOUCHPOWER"
elif printf '%s\n' "$USB_DUMP" | grep -q 'package_name=ch.chargeurs.kiosk.staging'; then
  echo "USB_DEFAULT_HANDLER=CHARGEURS_STAGING"
else
  echo "USB_DEFAULT_HANDLER=UNKNOWN"
fi

echo "== Vendor app state =="
VENDOR_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$VENDOR_PKG" 2>/dev/null | tr -d '\r')"
if [[ -n "$VENDOR_DUMP" ]]; then
  echo "VENDOR_APP_INSTALLED=true"
  printf '%s\n' "$VENDOR_DUMP" | grep -E 'versionName=|versionCode=|enabled=' | head -20 || true
else
  echo "VENDOR_APP_INSTALLED=false"
fi

if "$ADB" -s "$SERIAL" shell ps -A 2>/dev/null | grep -q "$VENDOR_PKG"; then
  echo "VENDOR_APP_PROCESS=RUNNING"
else
  echo "VENDOR_APP_PROCESS=NOT_RUNNING"
fi

echo "== Recent BBPOS / USB kernel events =="
DMESG="$("$ADB" -s "$SERIAL" shell dmesg 2>/dev/null | tr -d '\r')"
printf '%s\n' "$DMESG" | grep -Ei '15a2|5538|BBPOS|WPC323211052352|usb 2-1\.4|USB disconnect|unable to enumerate|device descriptor read|not accepting address|error -32' | tail -160 || true

if [[ -n "$TARGET_LINE" ]]; then
  if printf '%s\n' "$DMESG" | tail -200 | grep -Eqi 'error -32|unable to enumerate|not accepting address'; then
    echo "REFERENCE_USB_CLASSIFICATION=LIVE_BBPOS_WITH_RECENT_ENUMERATION_ERRORS"
  else
    echo "REFERENCE_USB_CLASSIFICATION=LIVE_BBPOS_CLEAN_ENUMERATION"
  fi
elif printf '%s\n' "$DMESG" | grep -Eqi 'error -32|unable to enumerate|not accepting address'; then
  echo "REFERENCE_USB_CLASSIFICATION=BBPOS_ABSENT_WITH_ENUMERATION_ERRORS"
elif printf '%s\n' "$DMESG" | grep -Eqi '15a2|5538|BBPOS|WPC323211052352'; then
  echo "REFERENCE_USB_CLASSIFICATION=BBPOS_SEEN_HISTORICALLY_NOT_LIVE"
else
  echo "REFERENCE_USB_CLASSIFICATION=NO_BBPOS_EVIDENCE"
fi

echo "DTA21277_ANDROID_USB_TRUTH_DONE"
