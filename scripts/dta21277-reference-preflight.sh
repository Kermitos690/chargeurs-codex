#!/usr/bin/env bash
set -euo pipefail

PKG="ch.chargeurs.kiosk.staging"
TARGET_STATION="DTA21277"
TARGET_VENDOR="15a2"
TARGET_PRODUCT="0101"
# Positively identified by the successful DTA21277 bootstrap. Wireless-debugging
# TCP ports rotate, but this adb TLS service identity remains the stable anchor.
TARGET_MDNS_SERIAL="${DTA21277_MDNS_SERIAL:-adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp}"
TARGET_MDNS_NAME="${DTA21277_MDNS_NAME:-adb-3d24b8cbb7d560bc-r6qk3T}"
LAST_KNOWN_ENDPOINT="${DTA21277_LAST_KNOWN_ENDPOINT:-192.168.8.139:39935}"

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

serial_is_live() {
  local serial="$1"
  [[ -n "$serial" ]] && "$ADB" -s "$serial" get-state >/dev/null 2>&1
}

mdns_endpoint_for_target() {
  "$ADB" mdns services 2>/dev/null \
    | awk -v name="$TARGET_MDNS_NAME" '$1==name && $2=="_adb-tls-connect._tcp" {print $3; exit}'
}

find_connected_target_by_station() {
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

  # Prefer the stable DTA21277 mDNS identity and whatever TCP endpoint it
  # currently advertises. The numeric port can rotate between ADB sessions.
  endpoint="$(mdns_endpoint_for_target || true)"
  if [[ -n "$endpoint" ]]; then
    "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
  fi

  if [[ -n "$LAST_KNOWN_ENDPOINT" ]]; then
    "$ADB" connect "$LAST_KNOWN_ENDPOINT" >/dev/null 2>&1 || true
  fi

  # Refresh all advertised endpoints as a fallback, but never infer station
  # identity from IP address alone.
  while read -r endpoint; do
    [[ -n "$endpoint" ]] || continue
    "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
  done < <("$ADB" mdns services 2>/dev/null \
    | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' \
    | sort -u || true)
}

SERIAL="${DTA_SERIAL:-}"
IDENTITY_SOURCE="explicit"

if [[ -n "$SERIAL" ]]; then
  serial_is_live "$SERIAL" || "$ADB" connect "$SERIAL" >/dev/null 2>&1 || true
  serial_is_live "$SERIAL" || SERIAL=""
fi

# First choice: the stable mDNS service identity that was already positively
# identified as DTA21277. adb devices may expose this service name directly.
if [[ -z "$SERIAL" ]] && serial_is_live "$TARGET_MDNS_SERIAL"; then
  SERIAL="$TARGET_MDNS_SERIAL"
  IDENTITY_SOURCE="stable_mdns_identity"
fi

# Second choice: resolve that stable identity to its current rotating endpoint.
if [[ -z "$SERIAL" ]]; then
  endpoint="$(mdns_endpoint_for_target || true)"
  if [[ -n "$endpoint" ]]; then
    "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
    if serial_is_live "$endpoint"; then
      SERIAL="$endpoint"
      IDENTITY_SOURCE="stable_mdns_endpoint"
    fi
  fi
fi

# Third choice: use the app's station_id if it is currently readable.
if [[ -z "$SERIAL" ]]; then
  SERIAL="$(find_connected_target_by_station || true)"
  [[ -z "$SERIAL" ]] || IDENTITY_SOURCE="station_id"
fi

if [[ -z "$SERIAL" ]]; then
  echo "DTA21277 not currently resolved; refreshing wireless ADB candidates..."
  refresh_adb_candidates
  sleep 2

  if serial_is_live "$TARGET_MDNS_SERIAL"; then
    SERIAL="$TARGET_MDNS_SERIAL"
    IDENTITY_SOURCE="stable_mdns_identity_after_refresh"
  else
    endpoint="$(mdns_endpoint_for_target || true)"
    if [[ -n "$endpoint" ]] && serial_is_live "$endpoint"; then
      SERIAL="$endpoint"
      IDENTITY_SOURCE="stable_mdns_endpoint_after_refresh"
    else
      SERIAL="$(find_connected_target_by_station || true)"
      [[ -z "$SERIAL" ]] || IDENTITY_SOURCE="station_id_after_refresh"
    fi
  fi
fi

if [[ -z "$SERIAL" ]]; then
  echo "== ADB candidates after refresh =="
  "$ADB" devices -l || true
  echo "== adb mDNS services =="
  "$ADB" mdns services 2>/dev/null || true
  fail "Could not reconnect DTA21277 by its stable ADB identity. Keep Wireless debugging enabled on DTA21277 and rerun."
fi

serial_is_live "$SERIAL" || fail "$TARGET_STATION ADB not responding"

echo "REFERENCE_STATION=$TARGET_STATION"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "REFERENCE_IDENTITY_SOURCE=$IDENTITY_SOURCE"
echo "ACTION=READ_ONLY_REFERENCE_PREFLIGHT"
echo "No payment, ejection, reboot, install, USB reset, or app-data change will be performed."

STATION="$(station_for_serial "$SERIAL" || true)"
echo "DETECTED_STATION_ID=${STATION:-UNKNOWN}"
# station_id is now a corroborating check, not the sole discovery mechanism.
# A non-empty contradiction remains a hard stop; UNKNOWN is allowed because the
# old 1.0.29 build has shown intermittent run-as/shared_prefs readability.
if [[ -n "$STATION" && "$STATION" != "$TARGET_STATION" ]]; then
  fail "Stable DTA21277 ADB identity reports station_id=$STATION, expected $TARGET_STATION"
fi

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
