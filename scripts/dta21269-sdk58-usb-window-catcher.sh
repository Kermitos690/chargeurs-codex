#!/usr/bin/env bash
set -euo pipefail

PKG="ch.chargeurs.kiosk.staging"
TARGET_PATH="/sys/bus/usb/devices/2-1.4"
EXPECTED_SDK="5.8.0-test-only"

fail() { echo "ERROR: $*" >&2; exit 1; }

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="${ADB:-$ANDROID_HOME/platform-tools/adb}"
[[ -x "$ADB" ]] || ADB="$(command -v adb || true)"
[[ -x "$ADB" ]] || fail "adb not found"

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
[[ -n "$SERIAL" ]] || fail "DTA21269 ADB not connected"
"$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "DTA21269 ADB not responding"

echo "ADB device: $SERIAL"
echo "ACTION=TRANSIENT_USB_WINDOW_CATCHER"
echo "No payment, ejection, reboot, reinstall, USB reset, or app-data deletion will be performed."
echo "This probe checks the known WisePad port about 4 times/second and starts Chargeurs immediately when 15a2:0101 appears."

is_target_present() {
  local out
  out="$("$ADB" -s "$SERIAL" shell "v=\$(cat '$TARGET_PATH/idVendor' 2>/dev/null); p=\$(cat '$TARGET_PATH/idProduct' 2>/dev/null); printf '%s:%s' \"\$v\" \"\$p\"" 2>/dev/null | tr -d '\r\n' | tr '[:upper:]' '[:lower:]' || true)"
  [[ "$out" == "15a2:0101" ]]
}

if ! is_target_present; then
  echo
  echo "WisePad is not present right now. Disconnect/reconnect only its accessible USB cable once."
  echo "Waiting up to 180 seconds for a usable USB window..."
fi

CAUGHT=0
for tick in $(seq 1 720); do
  if is_target_present; then
    # Require two consecutive positive samples to avoid acting on a descriptor half-state.
    sleep 0.20
    if is_target_present; then
      CAUGHT=1
      echo "USB_WINDOW_CAUGHT_AT_TICK=$tick"
      break
    fi
  fi
  if (( tick % 40 == 0 )); then echo "Waiting... $((tick / 4))/180s"; fi
  sleep 0.25
done

if [[ "$CAUGHT" != "1" ]]; then
  echo "USB_WINDOW_RESULT=NO_STABLE_ENUMERATION_CAUGHT"
  "$ADB" -s "$SERIAL" shell dmesg 2>/dev/null \
    | grep -Ei 'usb 2-1\.4|disconnect|unable to enumerate|device descriptor|not accepting address|error -32|15a2|BBPOS' \
    | tail -120 || true
  exit 20
fi

# Start from a fresh Chargeurs process while the reader is known-present.
"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" logcat -c >/dev/null 2>&1 || true
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.MainActivity" >/dev/null 2>&1 || true
START_MS="$(date +%s)"
echo "CHARGEURS_STARTED_IMMEDIATELY=1"

TMP="$(mktemp -d /tmp/dta21269-usb-window.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

capture_snapshot() {
  local label="$1"
  "$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump "/sdcard/chargeurs-window-${label}.xml" >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat "/sdcard/chargeurs-window-${label}.xml" > "$TMP/${label}.xml" 2>/dev/null || true
  python3 - "$TMP/${label}.xml" "$label" <<'PY'
import json, sys, xml.etree.ElementTree as ET
path, label = sys.argv[1:]
try:
    root = ET.parse(path).getroot()
except Exception:
    print(f"SNAPSHOT_{label}=UNAVAILABLE")
    raise SystemExit(0)
payload = None
for node in root.iter('node'):
    text = node.attrib.get('text', '')
    if text.startswith('{') and 'stripeTerminalReadiness' in text:
        try:
            payload = json.loads(text)
            break
        except Exception:
            pass
if not payload:
    print(f"SNAPSHOT_{label}=NO_PAYLOAD")
    raise SystemExit(0)
r = payload.get('stripeTerminalReadiness') or {}
d = r.get('diagnostics') or {}
summary = {
    'readerState': r.get('readerState'),
    'capability': r.get('capability'),
    'stripeSdk': d.get('stripeSdk'),
    'sdkConnectionStatus': d.get('sdkConnectionStatus'),
    'usbPresent': d.get('usbPresent'),
    'usbPermission': d.get('usbPermission'),
    'locationPermission': d.get('locationPermission'),
    'paymentApi': d.get('paymentApi'),
    'stripeLocationId': d.get('stripeLocationId'),
    'expectedReaderId': d.get('expectedReaderId'),
    'stripeReaderId': d.get('stripeReaderId'),
    'discoveredReaderId': d.get('discoveredReaderId'),
    'discoveryRunning': d.get('discoveryRunning'),
    'connectionRunning': d.get('connectionRunning'),
    'errorCode': d.get('errorCode'),
}
print(f"SNAPSHOT_{label}=" + json.dumps(summary, separators=(',', ':')))
PY
}

# Observe both USB stability and fresh runtime state across the first 25 seconds.
DROPPED=0
for sec in $(seq 1 25); do
  if ! is_target_present; then
    echo "USB_DROPPED_AFTER_CHARGEURS_START_AT=${sec}s"
    DROPPED=1
    break
  fi
  case "$sec" in
    3) capture_snapshot T3 ;;
    10) capture_snapshot T10 ;;
    20) capture_snapshot T20 ;;
  esac
  sleep 1
done

# Final fresh snapshot if USB survived long enough.
if [[ "$DROPPED" == "0" ]]; then
  capture_snapshot FINAL
fi

echo "== Fresh Chargeurs / Stripe logs =="
"$ADB" -s "$SERIAL" logcat -d -t 1600 2>/dev/null \
  | grep -E 'ChargeursStripe58|StripeTerminal|TERMINAL_LOCATION|CONNECTION_TOKEN|Terminal reader state|USB discovery started|connectReader' \
  | tail -220 || true

echo "== Recent WisePad kernel events =="
"$ADB" -s "$SERIAL" shell dmesg 2>/dev/null \
  | grep -Ei 'usb 2-1\.4|disconnect|unable to enumerate|device descriptor|not accepting address|error -32|15a2|BBPOS' \
  | tail -100 || true

if [[ "$DROPPED" == "1" ]]; then
  echo "USB_WINDOW_RESULT=USB_DROPPED_DURING_STRIPE_STARTUP"
  exit 21
fi

# Classify from the final fresh snapshot.
set +e
python3 - "$TMP/FINAL.xml" "$EXPECTED_SDK" <<'PY'
import json, sys, xml.etree.ElementTree as ET
path, expected = sys.argv[1:]
try:
    root = ET.parse(path).getroot()
except Exception:
    print('USB_WINDOW_RESULT=FINAL_DIAGNOSTIC_UNAVAILABLE')
    raise SystemExit(30)
payload = None
for node in root.iter('node'):
    text = node.attrib.get('text', '')
    if text.startswith('{') and 'stripeTerminalReadiness' in text:
        try:
            payload = json.loads(text)
            break
        except Exception:
            pass
if not payload:
    print('USB_WINDOW_RESULT=FINAL_DIAGNOSTIC_NO_PAYLOAD')
    raise SystemExit(31)
r = payload.get('stripeTerminalReadiness') or {}
d = r.get('diagnostics') or {}
ready = (
    d.get('stripeSdk') == expected and
    d.get('paymentApi') == 'processPaymentIntent' and
    d.get('usbPresent') is True and
    d.get('usbPermission') is True and
    d.get('locationPermission') is True and
    d.get('sdkConnectionStatus') == 'CONNECTED' and
    r.get('readerState') == 'READY' and
    r.get('capability') == 'TERMINAL_AND_QR'
)
if ready:
    print('USB_WINDOW_RESULT=SDK58_FIELD_READY_PASS')
    raise SystemExit(0)
if d.get('errorCode'):
    print('USB_WINDOW_RESULT=RUNTIME_ERROR:' + str(d.get('errorCode')))
    raise SystemExit(40)
if d.get('sdkConnectionStatus') == 'NOT_INITIALIZED':
    if not d.get('stripeLocationId'):
        print('USB_WINDOW_RESULT=BINDING_BOOTSTRAP_NOT_COMPLETED')
    else:
        print('USB_WINDOW_RESULT=TERMINAL_INIT_NOT_REACHED_WITH_BINDING_PRESENT')
    raise SystemExit(41)
print('USB_WINDOW_RESULT=SDK_STARTED_BUT_READER_NOT_READY')
raise SystemExit(42)
PY
STATUS=$?
set -e
exit "$STATUS"
