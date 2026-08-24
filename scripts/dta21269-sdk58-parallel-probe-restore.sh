#!/usr/bin/env bash
set -euo pipefail
OLD_PKG="ch.chargeurs.kiosk.staging"
NEW_PKG="ch.chargeurs.kiosk.sdk58probe"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$ADB" ]] || { echo "ERROR: adb not found" >&2; exit 2; }
pick_serial() {
  local serial endpoint
  serial="$("$ADB" devices | awk '$2=="device" && $1 ~ /^[0-9]+\./ {print $1; exit}')"
  [[ -n "$serial" ]] || serial="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  if [[ -z "$serial" ]]; then
    endpoint="$("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | head -1 || true)"
    if [[ -n "$endpoint" ]]; then
      "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
      "$ADB" -s "$endpoint" get-state >/dev/null 2>&1 && serial="$endpoint"
    fi
  fi
  printf '%s' "$serial"
}
SERIAL="${DTA_SERIAL:-$(pick_serial)}"
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || {
  echo "ERROR: DTA21269 ADB device not connected" >&2; exit 3;
}
"$ADB" -s "$SERIAL" shell pm path "$OLD_PKG" | grep -q '^package:' || {
  echo "ERROR: canonical staging package missing; refusing restore" >&2; exit 4;
}
"$ADB" -s "$SERIAL" shell am force-stop "$NEW_PKG" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell monkey -p "$OLD_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 2
echo "DTA21269_CANONICAL_APP_RESTORED"
echo "Canonical package active: $OLD_PKG"
echo "Probe package remains installed but stopped: $NEW_PKG"
