#!/usr/bin/env bash
set -euo pipefail

PKG="ch.chargeurs.kiosk.staging"
TARGET_STATION="DTA21277"
TARGET_VENDOR="15a2"
TARGET_PRODUCT="0101"
LAST_KNOWN_ENDPOINT="${DTA21277_LAST_KNOWN_ENDPOINT:-192.168.8.139:41373}"

fail() { echo "ERROR: $*" >&2; exit 1; }

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$ADB" ]] || fail "adb not found"

station_for_serial() {
  local serial="$1"
  "$ADB" -s "$serial" shell "run-as '$PKG' cat shared_prefs/chargeurs_kiosk_config.xml 2>/dev/null" 2>/dev/null \
    | tr -d '\r' \
    | sed -n 's/.*name="station_id"[^>]*>\([^<]*\)<.*/\1/p' \
    | head -1
}

find_connected_target() {
  local candidate state detected
  while read -r candidate state _; do
    [[ "$state" == "device" ]] || continue
    detected="$(station_for_serial "$candidate" || true)"
    if [[ "$detected" == "$TARGET_STATION" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done < <("$ADB" devices -l | tail -n +2)
  return 1
}

refresh_adb_candidates() {
  local endpoint

  # First retry the endpoint that was positively identified as DTA21277 by the
  # previous bootstrap. A stale port is harmless: adb connect will simply fail.
  if [[ -n "$LAST_KNOWN_ENDPOINT" ]]; then
    "$ADB" connect "$LAST_KNOWN_ENDPOINT" >/dev/null 2>&1 || true
  fi

  # Wireless-debugging ports can rotate. Ask adb mDNS for every currently
  # advertised endpoint and connect them, then identify the station from its
  # own encrypted app configuration rather than from IP/port assumptions.
  while read -r endpoint; do
    [[ -n "$endpoint" ]] || continue
    "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
  done < <("$ADB" mdns services 2>/dev/null \
    | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' \
    | sort -u || true)
}

SERIAL="${DTA_SERIAL:-}"
if [[ -n "$SERIAL" ]]; then
  "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || "$ADB" connect "$SERIAL" >/dev/null 2>&1 || true
  if [[ "$(station_for_serial "$SERIAL" || true)" != "$TARGET_STATION" ]]; then
    SERIAL=""
  fi
fi

if [[ -z "$SERIAL" ]]; then
  SERIAL="$(find_connected_target || true)"
fi

if [[ -z "$SERIAL" ]]; then
  echo "DTA21277 not currently resolved; refreshing wireless ADB candidates..."
  refresh_adb_candidates
  sleep 2
  SERIAL="$(find_connected_target || true)"
fi

if [[ -z "$SERIAL" ]]; then
  echo "== ADB candidates after refresh =="
  "$ADB" devices -l || true
  echo "== adb mDNS services =="
  "$ADB" mdns services 2>/dev/null || true
  fail "Could not reconnect an ADB device enrolled as $TARGET_STATION. Keep Wireless debugging enabled on DTA21277 and rerun."
fi

"$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "$TARGET_STATION ADB not responding"

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "ACTION=READ_ONLY_REFERENCE_PREFLIGHT"
echo "No payment, ejection, reboot, install, USB reset, or app-data change will be performed."

STATION="$(station_for_serial "$SERIAL" || true)"
echo "DETECTED_STATION_ID=${STATION:-UNKNOWN}"
[[ "$STATION" == "$TARGET_STATION" ]] || fail "ADB target is not $TARGET_STATION"

PKG_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r')"
VERSION_CODE="$(printf '%s\n' "$PKG_DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
VERSION_NAME="$(printf '%s\n' "$PKG_DUMP" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
echo "CHARGEURS_VERSION_CODE=${VERSION_CODE:-UNKNOWN}"
echo "CHARGEURS_VERSION_NAME=${VERSION_NAME:-UNKNOWN}"

TMP="$(mktemp -d /tmp/dta21277-preflight.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

BASE_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" 2>/dev/null | sed -n 's/^package://p' | head -1 | tr -d '\r')"
if [[ -n "$BASE_PATH" ]]; then
  "$ADB" -s "$SERIAL" pull "$BASE_PATH" "$TMP/installed.apk" >/dev/null 2>&1 || true
fi

APKSIGNER=""
if [[ -d "$ANDROID_HOME/build-tools" ]]; then
  APKSIGNER="$(find "$ANDROID_HOME/build-tools" -type f -name apksigner -perm -111 2>/dev/null | sort -V | tail -1 || true)"
fi
[[ -x "$APKSIGNER" ]] || APKSIGNER="$(command -v apksigner || true)"
if [[ -f "$TMP/installed.apk" && -x "$APKSIGNER" ]]; then
  SIGNER="$("$APKSIGNER" verify --print-certs "$TMP/installed.apk" 2>/dev/null \
    | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr '[:upper:]' '[:lower:]')"
  echo "INSTALLED_APK_SIGNER_SHA256=${SIGNER:-UNKNOWN}"
else
  echo "INSTALLED_APK_SIGNER_SHA256=UNAVAILABLE"
fi

echo "== Kernel USB inventory =="
TARGET_PATH=""
for d in /sys/bus/usb/devices/*; do
  vendor="$("$ADB" -s "$SERIAL" shell "cat '$d/idVendor' 2>/dev/null" | tr -d '\r\n' || true)"
  product="$("$ADB" -s "$SERIAL" shell "cat '$d/idProduct' 2>/dev/null" | tr -d '\r\n' || true)"
  [[ -n "$vendor" && -n "$product" ]] || continue
  manufacturer="$("$ADB" -s "$SERIAL" shell "cat '$d/manufacturer' 2>/dev/null" | tr -d '\r\n' || true)"
  product_name="$("$ADB" -s "$SERIAL" shell "cat '$d/product' 2>/dev/null" | tr -d '\r\n' || true)"
  printf '%s %s:%s manufacturer=%s product=%s\n' "$d" "$vendor" "$product" "$manufacturer" "$product_name"
  vendor_lc="$(printf '%s' "$vendor" | tr '[:upper:]' '[:lower:]')"
  product_lc="$(printf '%s' "$product" | tr '[:upper:]' '[:lower:]')"
  if [[ "$vendor_lc" == "$TARGET_VENDOR" && "$product_lc" == "$TARGET_PRODUCT" ]]; then
    TARGET_PATH="$d"
  fi
done

if [[ -n "$TARGET_PATH" ]]; then
  echo "WISEPAD_USB=PRESENT"
  echo "WISEPAD_KERNEL_PATH=$TARGET_PATH"
else
  echo "WISEPAD_USB=ABSENT"
fi

echo "== Android USB service BBPOS context =="
"$ADB" -s "$SERIAL" shell dumpsys usb 2>/dev/null \
  | grep -Ei -C 5 'BBPOS|5538|257|15a2|0101|WPC323211052352' \
  | tail -120 || true

echo "== Recent kernel USB events =="
DMESG="$("$ADB" -s "$SERIAL" shell dmesg 2>/dev/null || true)"
printf '%s\n' "$DMESG" \
  | grep -Ei '15a2|5538|BBPOS|WPC323211052352|unable to enumerate|device descriptor read|not accepting address|error -32|USB disconnect' \
  | tail -120 || true

if [[ -n "$TARGET_PATH" ]]; then
  echo "REFERENCE_USB_CLASSIFICATION=WISEPAD_ENUMERATED"
elif printf '%s\n' "$DMESG" | grep -Eqi 'unable to enumerate|device descriptor read|not accepting address|error -32'; then
  echo "REFERENCE_USB_CLASSIFICATION=ENUMERATION_FAILURE_PRESENT"
elif printf '%s\n' "$DMESG" | grep -Eqi '15a2|5538|BBPOS|WPC323211052352'; then
  echo "REFERENCE_USB_CLASSIFICATION=WISEPAD_SEEN_HISTORICALLY_BUT_NOT_CURRENTLY"
else
  echo "REFERENCE_USB_CLASSIFICATION=NO_WISEPAD_ENUMERATION_EVIDENCE"
fi

echo "DTA21277_REFERENCE_PREFLIGHT_DONE"
