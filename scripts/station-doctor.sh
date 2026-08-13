#!/usr/bin/env bash
set -euo pipefail

# Chargeurs.ch Station Doctor — SAFE DIAGNOSTIC ONLY
# Read-only Android/macOS checks. This script never ejects a battery, starts a payment,
# installs/uninstalls an APK, clears app data, changes USB permissions, or enables ADB over TCP.

ADB_BIN="${ADB_BIN:-adb}"
OUT_DIR="${OUT_DIR:-./station-doctor-output}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$OUT_DIR/$STAMP"
mkdir -p "$RUN_DIR"

pass() { printf 'PASS | %s\n' "$*"; }
warn() { printf 'WARN | %s\n' "$*"; }
fail() { printf 'FAIL | %s\n' "$*"; }
nt()   { printf 'NOT_TESTABLE | %s\n' "$*"; }

printf 'Chargeurs.ch Station Doctor\n'
printf 'mode=SAFE_DIAGNOSTIC timestamp=%s\n' "$STAMP"
printf 'output=%s\n\n' "$RUN_DIR"

if command -v system_profiler >/dev/null 2>&1; then
  system_profiler SPUSBDataType > "$RUN_DIR/macos-usb.txt" 2>&1 || true
  pass 'macOS USB inventory captured'
else
  nt 'system_profiler unavailable (expected on macOS)'
fi

if ! command -v "$ADB_BIN" >/dev/null 2>&1; then
  fail "adb not found. Install Android platform-tools, then rerun."
  exit 2
fi
pass "adb available: $($ADB_BIN version | head -n 1)"

$ADB_BIN devices -l > "$RUN_DIR/adb-devices.txt" 2>&1 || true
DEVICE_LINES="$($ADB_BIN devices | awk 'NR>1 && $2=="device" {print $1}')"
DEVICE_COUNT="$(printf '%s\n' "$DEVICE_LINES" | awk 'NF {count++} END {print count+0}')"
UNAUTHORIZED="$($ADB_BIN devices | awk 'NR>1 && $2=="unauthorized" {count++} END {print count+0}')"
OFFLINE="$($ADB_BIN devices | awk 'NR>1 && $2=="offline" {count++} END {print count+0}')"

if (( UNAUTHORIZED > 0 )); then
  warn "$UNAUTHORIZED Android device(s) waiting for USB debugging authorization on-screen"
fi
if (( OFFLINE > 0 )); then
  warn "$OFFLINE Android device(s) reported offline by adb"
fi

if (( DEVICE_COUNT == 0 )); then
  fail 'no authorized Android device detected over ADB'
  printf '\nNEXT ACTION\n'
  printf '1. Keep the station connected by a DATA-capable USB cable.\n'
  printf '2. Enable/authorize USB debugging on the station if permitted.\n'
  printf '3. Run: adb devices -l\n'
  printf '4. Re-run this script once the device state is "device".\n'
  exit 3
fi

if (( DEVICE_COUNT > 1 )) && [ -z "${ANDROID_SERIAL:-}" ]; then
  fail "multiple authorized devices detected ($DEVICE_COUNT). Set ANDROID_SERIAL to the intended station and rerun."
  exit 4
fi

FIRST_DEVICE="$(printf '%s\n' "$DEVICE_LINES" | awk 'NF {print; exit}')"
SERIAL="${ANDROID_SERIAL:-$FIRST_DEVICE}"
export ANDROID_SERIAL="$SERIAL"
pass "ADB device selected: $SERIAL"

adbsh() { "$ADB_BIN" -s "$SERIAL" shell "$@"; }

if ! "$ADB_BIN" -s "$SERIAL" get-state 2>/dev/null | grep -qx 'device'; then
  fail "selected ANDROID_SERIAL is not in adb device state: $SERIAL"
  exit 5
fi

adbsh getprop > "$RUN_DIR/getprop.txt" 2>&1 || true
adbsh ip addr > "$RUN_DIR/ip-addr.txt" 2>&1 || true
adbsh dumpsys usb > "$RUN_DIR/dumpsys-usb.txt" 2>&1 || true
adbsh pm list packages > "$RUN_DIR/packages.txt" 2>&1 || true
adbsh wm size > "$RUN_DIR/wm-size.txt" 2>&1 || true
adbsh wm density > "$RUN_DIR/wm-density.txt" 2>&1 || true
adbsh id > "$RUN_DIR/id.txt" 2>&1 || true

MODEL="$(adbsh getprop ro.product.model 2>/dev/null | tr -d '\r')"
BOARD="$(adbsh getprop ro.product.board 2>/dev/null | tr -d '\r')"
ANDROID="$(adbsh getprop ro.build.version.release 2>/dev/null | tr -d '\r')"
SDK="$(adbsh getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')"
FINGERPRINT="$(adbsh getprop ro.build.fingerprint 2>/dev/null | tr -d '\r')"
ABI="$(adbsh getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r')"
IPV4="$(adbsh ip -4 addr show wlan0 2>/dev/null | awk '/inet / {print $2}' | head -n1 | tr -d '\r')"
if [ -z "$IPV4" ]; then
  IPV4="$(adbsh ip -4 addr show eth0 2>/dev/null | awk '/inet / {print $2}' | head -n1 | tr -d '\r')"
fi

printf '\nDEVICE IDENTITY\n'
printf 'serial=%s\nmodel=%s\nboard=%s\nandroid=%s sdk=%s\nabi=%s\nfingerprint=%s\nipv4=%s\n' \
  "$SERIAL" "$MODEL" "$BOARD" "$ANDROID" "$SDK" "$ABI" "$FINGERPRINT" "${IPV4:-unknown}"

ROOT_UID="$(adbsh id 2>/dev/null | sed -n 's/uid=\([0-9]*\).*/\1/p' | head -n1)"
if [ "$ROOT_UID" = "0" ]; then
  warn 'adb shell is running as root'
else
  pass "adb shell non-root uid=${ROOT_UID:-unknown}"
fi

KIOSK_PACKAGES="$(adbsh pm list packages 2>/dev/null | sed 's/^package://' | grep -E '^ch\.chargeurs\.kiosk($|\.)' || true)"
if [ -z "$KIOSK_PACKAGES" ]; then
  warn 'no Chargeurs kiosk package found with expected package prefix'
else
  printf '\nAPK\n'
  printf '%s\n' "$KIOSK_PACKAGES" | while IFS= read -r PKG; do
    [ -z "$PKG" ] && continue
    printf 'package=%s\n' "$PKG"
    adbsh dumpsys package "$PKG" > "$RUN_DIR/package-${PKG}.txt" 2>&1 || true
    APK_PATH="$(adbsh pm path "$PKG" 2>/dev/null | sed -n 's/^package://p' | head -n1 | tr -d '\r')"
    VERSION_NAME="$(adbsh dumpsys package "$PKG" 2>/dev/null | sed -n 's/.*versionName=//p' | head -n1 | tr -d '\r')"
    VERSION_CODE="$(adbsh dumpsys package "$PKG" 2>/dev/null | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -n1 | tr -d '\r')"
    printf 'apkPath=%s\nversionName=%s\nversionCode=%s\n' "${APK_PATH:-unknown}" "${VERSION_NAME:-unknown}" "${VERSION_CODE:-unknown}"
  done
  pass 'Chargeurs kiosk package metadata captured'
fi

if grep -Eqi '15a2.*0101|Vendor ID: 0x15a2|Product ID: 0x0101' "$RUN_DIR/macos-usb.txt" "$RUN_DIR/dumpsys-usb.txt" 2>/dev/null; then
  pass 'WisePad target USB identity 15a2:0101 appears in captured USB diagnostics'
else
  warn 'WisePad target USB identity 15a2:0101 not observed in current USB diagnostics'
fi

printf '\nNETWORK\n'
if [ -n "${IPV4:-}" ]; then
  pass "station has local IPv4: $IPV4"
else
  warn 'no wlan0/eth0 IPv4 detected'
fi

printf '\nAPI / BACKEND\n'
nt 'API/backend authenticated checks require project endpoint/config context; no destructive command was attempted'
nt 'station DTA/backend UUID not inferred from Android serial alone'

printf '\nHARDWARE SNAPSHOT\n'
nt 'slot/battery snapshot requires the canonical read-only station/backend endpoint; no cabinet command was issued'

printf '\nSAFETY\n'
pass 'no payment invoked'
pass 'no battery ejection invoked'
pass 'no APK install/uninstall invoked'
pass 'no app data cleared'
pass 'ADB-over-network was not enabled'

printf '\nRESULT\n'
printf 'PARTIAL | device-local evidence captured; backend/API/DTA binding still requires canonical project context\n'
printf 'Evidence directory: %s\n' "$RUN_DIR"
