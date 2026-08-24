#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
EXPECTED_BRANCH="fix/dta21269-terminal-sdk-5-7"
[[ "$(git -C "$ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]] || {
  echo "ERROR: expected branch $EXPECTED_BRANCH" >&2
  exit 2
}

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$ADB" ]] || { echo "ERROR: adb not found" >&2; exit 3; }

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
  echo "ERROR: DTA21269 ADB device not connected" >&2
  exit 4
}

echo "ADB device: $SERIAL"
echo "READ_ONLY_PROBE=1"
echo

echo "== 1/5 Live kernel USB inventory with descriptors =="
"$ADB" -s "$SERIAL" shell 'for d in /sys/bus/usb/devices/*; do
  [ -f "$d/idVendor" ] || continue
  v=$(cat "$d/idVendor" 2>/dev/null || true)
  p=$(cat "$d/idProduct" 2>/dev/null || true)
  m=$(cat "$d/manufacturer" 2>/dev/null || true)
  n=$(cat "$d/product" 2>/dev/null || true)
  s=$(cat "$d/serial" 2>/dev/null || true)
  printf "%s %s:%s manufacturer=%s product=%s serial=%s\n" "$d" "$v" "$p" "$m" "$n" "$s"
done' 2>/dev/null || true

echo
echo "== 2/5 Android USB service: BBPOS/15a2/5538 context =="
USB_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys usb 2>/dev/null | tr -d '\r' || true)"
if [[ -n "$USB_DUMP" ]]; then
  printf '%s\n' "$USB_DUMP" | python3 -c 'import sys
lines=sys.stdin.read().splitlines()
need=("bbpos","15a2","0101","5538","257","wisepad")
hits=[]
for i,line in enumerate(lines):
    low=line.lower()
    if any(x in low for x in need):
        a=max(0,i-8); b=min(len(lines),i+12)
        if not hits or a>hits[-1][1]: hits.append([a,b])
        else: hits[-1][1]=max(hits[-1][1],b)
if not hits:
    print("NO_BBPOS_CONTEXT_IN_DUMPSYS_USB")
else:
    for a,b in hits:
        print("---")
        for j in range(a,b): print(f"{j+1:04d}: {lines[j]}")'
else
  echo "USB_DUMP_UNAVAILABLE"
fi

echo
echo "== 3/5 Android USB role/state properties =="
"$ADB" -s "$SERIAL" shell getprop 2>/dev/null | grep -Ei '\[.*usb|usb.*\]' | head -120 || true

echo
echo "== 4/5 Recent kernel/logcat USB events (read-only) =="
DMESG_OUT="$("$ADB" -s "$SERIAL" shell dmesg 2>/dev/null | grep -Ei 'usb|bbpos|wise|15a2|0101' | tail -120 || true)"
if [[ -n "$DMESG_OUT" ]]; then printf '%s\n' "$DMESG_OUT"; else echo "DMESG_USB_EVENTS_UNAVAILABLE_OR_EMPTY"; fi

echo "-- logcat --"
"$ADB" -s "$SERIAL" logcat -b all -d -t 1200 2>/dev/null | grep -Ei 'UsbHostManager|UsbDeviceManager|usb device|bbpos|wisepad|15a2|0101|5538|product.?257' | tail -160 || true

echo
echo "== 5/5 Chargeurs + kernel classification =="
KERNEL_TARGET="$("$ADB" -s "$SERIAL" shell 'for d in /sys/bus/usb/devices/*; do [ -f "$d/idVendor" ] || continue; v=$(cat "$d/idVendor" 2>/dev/null); p=$(cat "$d/idProduct" 2>/dev/null); [ "$v:$p" = "15a2:0101" ] && echo yes && break; done' | tr -d '\r\n')"
BBPOS_LIVE="$("$ADB" -s "$SERIAL" shell 'for d in /sys/bus/usb/devices/*; do [ -f "$d/manufacturer" ] || continue; m=$(cat "$d/manufacturer" 2>/dev/null); echo "$m" | grep -qi bbpos && { v=$(cat "$d/idVendor" 2>/dev/null); p=$(cat "$d/idProduct" 2>/dev/null); echo "$v:$p"; break; }; done' | tr -d '\r\n')"

"$ADB" -s "$SERIAL" shell am start -n ch.chargeurs.kiosk.staging/ch.chargeurs.kiosk.HardwareDiagnosticActivity >/dev/null 2>&1 || true
sleep 1
"$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-usb-deep.xml >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-usb-deep.xml 2>/dev/null | python3 -c 'import sys,xml.etree.ElementTree as ET,html
raw=sys.stdin.read()
try: root=ET.fromstring(raw)
except Exception: print("CHARGEURS_DIAGNOSTIC_UNAVAILABLE"); raise SystemExit(0)
for n in root.iter("node"):
    t=n.attrib.get("text","")
    if "stripeTerminalReadiness" in t:
        print(html.unescape(t)); break' || true

if [[ "$KERNEL_TARGET" == "yes" ]]; then
  echo "USB_DEEP_CLASSIFICATION=TARGET_15A2_0101_LIVE"
elif [[ -n "$BBPOS_LIVE" ]]; then
  echo "USB_DEEP_CLASSIFICATION=BBPOS_LIVE_DIFFERENT_ID"
  echo "BBPOS_LIVE_ID=$BBPOS_LIVE"
else
  echo "USB_DEEP_CLASSIFICATION=NO_LIVE_BBPOS_DEVICE_IN_KERNEL"
fi

echo "No USB reset, permission change, app reinstall, payment, or ejection was performed."
