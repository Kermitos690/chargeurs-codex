#!/usr/bin/env bash
set -u

PKG="ch.chargeurs.kiosk.staging"
SERIAL="${DTA21277_SERIAL:-adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp}"
TARGET_VENDOR="15a2"
TARGET_PRODUCT="0101"

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
if [[ ! -x "$ADB" ]]; then
  ADB="$(command -v adb 2>/dev/null || true)"
fi
if [[ -z "$ADB" || ! -x "$ADB" ]]; then
  echo "REFERENCE_CORE_RESULT=ADB_NOT_FOUND"
  exit 2
fi

if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  endpoint="$("$ADB" mdns services 2>/dev/null | awk '$1=="adb-3d24b8cbb7d560bc-r6qk3T" && $2=="_adb-tls-connect._tcp" {print $3; exit}')"
  if [[ -n "$endpoint" ]]; then
    "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
    if "$ADB" -s "$endpoint" get-state >/dev/null 2>&1; then
      SERIAL="$endpoint"
    fi
  fi
fi

if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  echo "REFERENCE_CORE_RESULT=DTA21277_ADB_NOT_CONNECTED"
  "$ADB" devices -l || true
  "$ADB" mdns services 2>/dev/null || true
  exit 3
fi

echo "REFERENCE_STATION=DTA21277"
echo "REFERENCE_ADB_SERIAL=$SERIAL"
echo "ACTION=READ_ONLY_REFERENCE_CORE_CHECK"
echo "No payment, ejection, reboot, install, USB reset, or app-data change will be performed."

station_xml="$("$ADB" -s "$SERIAL" shell "run-as '$PKG' cat shared_prefs/chargeurs_kiosk_config.xml 2>/dev/null" 2>/dev/null | tr -d '\r' || true)"
station_id="$(printf '%s' "$station_xml" | sed -n 's/.*<string name="station_id">\([^<]*\)<\/string>.*/\1/p' | head -1)"
echo "DETECTED_STATION_ID=${station_id:-UNKNOWN}"

pkg_dump="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' || true)"
version_code="$(printf '%s\n' "$pkg_dump" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
version_name="$(printf '%s\n' "$pkg_dump" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
echo "CHARGEURS_VERSION_CODE=${version_code:-UNKNOWN}"
echo "CHARGEURS_VERSION_NAME=${version_name:-UNKNOWN}"

TMP="$(mktemp -d /tmp/dta21277-core.XXXXXX 2>/dev/null || mktemp -d -t dta21277-core)"
trap 'rm -rf "$TMP"' EXIT

base_path="$("$ADB" -s "$SERIAL" shell pm path "$PKG" 2>/dev/null | sed -n 's/^package://p' | head -1 | tr -d '\r' || true)"
installed_apk="$TMP/installed.apk"
if [[ -n "$base_path" ]]; then
  "$ADB" -s "$SERIAL" pull "$base_path" "$installed_apk" >/dev/null 2>&1 || true
fi

apksigner=""
if [[ -d "$ANDROID_HOME/build-tools" ]]; then
  apksigner="$(find "$ANDROID_HOME/build-tools" -type f -name apksigner -perm -111 2>/dev/null | sort -V | tail -1 || true)"
fi
if [[ -z "$apksigner" ]]; then
  apksigner="$(command -v apksigner 2>/dev/null || true)"
fi

installed_signer=""
if [[ -f "$installed_apk" && -n "$apksigner" && -x "$apksigner" ]]; then
  installed_signer="$("$apksigner" verify --print-certs "$installed_apk" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr '[:upper:]' '[:lower:]' || true)"
fi
echo "INSTALLED_APK_SIGNER_SHA256=${installed_signer:-UNAVAILABLE}"

echo "== Kernel USB inventory =="
target_path=""
for d in /sys/bus/usb/devices/*; do
  vendor="$("$ADB" -s "$SERIAL" shell "cat '$d/idVendor' 2>/dev/null" 2>/dev/null | tr -d '\r\n' || true)"
  product="$("$ADB" -s "$SERIAL" shell "cat '$d/idProduct' 2>/dev/null" 2>/dev/null | tr -d '\r\n' || true)"
  [[ -n "$vendor" && -n "$product" ]] || continue
  manufacturer="$("$ADB" -s "$SERIAL" shell "cat '$d/manufacturer' 2>/dev/null" 2>/dev/null | tr -d '\r\n' || true)"
  product_name="$("$ADB" -s "$SERIAL" shell "cat '$d/product' 2>/dev/null" 2>/dev/null | tr -d '\r\n' || true)"
  echo "$d ${vendor}:${product} manufacturer=${manufacturer} product=${product_name}"
  vendor_lc="$(printf '%s' "$vendor" | tr '[:upper:]' '[:lower:]')"
  product_lc="$(printf '%s' "$product" | tr '[:upper:]' '[:lower:]')"
  if [[ "$vendor_lc" == "$TARGET_VENDOR" && "$product_lc" == "$TARGET_PRODUCT" ]]; then
    target_path="$d"
  fi
done

if [[ -n "$target_path" ]]; then
  echo "WISEPAD_USB=PRESENT"
  echo "WISEPAD_KERNEL_PATH=$target_path"
else
  echo "WISEPAD_USB=ABSENT"
fi

echo "== Android USB service BBPOS context =="
"$ADB" -s "$SERIAL" shell dumpsys usb 2>/dev/null | grep -Ei -C 6 'BBPOS|5538|257|15a2|0101|WPC323211052352' | tail -140 || true

echo "== Recent kernel USB events =="
dmesg_text="$("$ADB" -s "$SERIAL" shell dmesg 2>/dev/null || true)"
printf '%s\n' "$dmesg_text" | grep -Ei '15a2|5538|BBPOS|WPC323211052352|unable to enumerate|device descriptor read|not accepting address|error -32|USB disconnect' | tail -140 || true

if [[ -n "$target_path" ]]; then
  echo "REFERENCE_USB_CLASSIFICATION=WISEPAD_ENUMERATED"
elif printf '%s\n' "$dmesg_text" | grep -Eqi 'unable to enumerate|device descriptor read|not accepting address|error -32'; then
  echo "REFERENCE_USB_CLASSIFICATION=ENUMERATION_FAILURE_PRESENT"
elif printf '%s\n' "$dmesg_text" | grep -Eqi '15a2|5538|BBPOS|WPC323211052352'; then
  echo "REFERENCE_USB_CLASSIFICATION=WISEPAD_SEEN_HISTORICALLY_BUT_NOT_CURRENTLY"
else
  echo "REFERENCE_USB_CLASSIFICATION=NO_WISEPAD_ENUMERATION_EVIDENCE"
fi

echo "DTA21277_REFERENCE_CORE_CHECK_DONE"
