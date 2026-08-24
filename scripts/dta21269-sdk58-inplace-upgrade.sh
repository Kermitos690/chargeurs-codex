#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BRANCH="fix/dta21269-terminal-sdk-5-7"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_VERSION_CODE="158"
EXPECTED_VERSION_NAME="1.0.58-terminal-sdk580-process-reconnect-staging"
EXPECTED_SDK="5.8.0-test-only"
ROOT="$(git rev-parse --show-toplevel)"

fail() { echo "ERROR: $*" >&2; exit 1; }
trap 's=$?; if [[ $s -ne 0 ]]; then echo "FAILED line=$LINENO command=$BASH_COMMAND" >&2; fi' ERR

[[ "$(git -C "$ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]] || fail "wrong branch"

resolve_java_home() {
  local c
  for c in \
    "${JAVA_HOME:-}" \
    "$HOME/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/jdk-21.0.12.1+1/Contents/Home" \
    "$HOME/Library/Caches/chargeurs-jdk/temurin21-aarch64/unpack/jdk-21.0.12.1+1/Contents/Home" \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  do
    [[ -n "$c" && -x "$c/bin/java" ]] || continue
    local major
    major="$("$c/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9][0-9]*\).*/\1/p')"
    [[ "$major" =~ ^[0-9]+$ && "$major" -ge 17 ]] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

resolve_android_sdk() {
  local c
  for c in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
    [[ -n "$c" && -x "$c/platform-tools/adb" && -d "$c/build-tools" ]] || continue
    printf '%s' "$c"; return 0
  done
  return 1
}

JAVA_HOME="$(resolve_java_home || true)"
[[ -n "$JAVA_HOME" ]] || fail "JDK 17+ not found"
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
ANDROID_HOME="$(resolve_android_sdk || true)"
[[ -n "$ANDROID_HOME" ]] || fail "Android SDK not found"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
ADB="$ANDROID_HOME/platform-tools/adb"
APKSIGNER="$(find "$ANDROID_HOME/build-tools" -type f -name apksigner -perm -u+x 2>/dev/null | sort -V | tail -1)"
AAPT="$(find "$ANDROID_HOME/build-tools" -type f -name aapt -perm -u+x 2>/dev/null | sort -V | tail -1)"
[[ -x "$APKSIGNER" && -x "$AAPT" ]] || fail "Android build tools missing"

cert_sha() {
  "$APKSIGNER" verify --print-certs "$1" \
    | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    | head -1 | tr '[:upper:]' '[:lower:]' | tr -d ':'
}

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

mkdir -p "$ROOT/android-kiosk"
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ROOT/android-kiosk/local.properties"

# Use the same local signer that is already installed on the field tablet.
export CHARGEURS_STAGING_KEYSTORE_PATH="${CHARGEURS_STAGING_KEYSTORE_PATH:-$HOME/.android/debug.keystore}"
export CHARGEURS_STAGING_KEYSTORE_PASSWORD="${CHARGEURS_STAGING_KEYSTORE_PASSWORD:-android}"
export CHARGEURS_STAGING_KEY_ALIAS="${CHARGEURS_STAGING_KEY_ALIAS:-androiddebugkey}"
export CHARGEURS_STAGING_KEY_PASSWORD="${CHARGEURS_STAGING_KEY_PASSWORD:-android}"
[[ -f "$CHARGEURS_STAGING_KEYSTORE_PATH" ]] || fail "staging keystore missing"

echo "== 1/4 Build canonical staging APK with Stripe Terminal 5.8 =="
cd "$ROOT/android-kiosk"
./gradlew --no-daemon --console=plain :app:assembleStaging
APK="$ROOT/android-kiosk/app/build/outputs/apk/staging/app-staging.apk"
[[ -f "$APK" ]] || fail "staging APK not produced"

BADGING="$($AAPT dump badging "$APK" | head -1)"
echo "$BADGING" | grep -q "package: name='$PKG'" || fail "wrong package"
echo "$BADGING" | grep -q "versionCode='$EXPECTED_VERSION_CODE'" || fail "wrong versionCode"
echo "$BADGING" | grep -q "versionName='$EXPECTED_VERSION_NAME'" || fail "wrong versionName"
NEW_SIGNER="$(cert_sha "$APK")"
[[ -n "$NEW_SIGNER" ]] || fail "new APK signer unavailable"
echo "New APK signer: $NEW_SIGNER"

BUILD_CONFIG="$(find "$ROOT/android-kiosk/app/build/generated" -type f -path '*/staging/*/ch/chargeurs/kiosk/BuildConfig.java' | head -1 || true)"
[[ -f "$BUILD_CONFIG" ]] || fail "generated staging BuildConfig missing"
grep -q 'HARDWARE_EJECTION_ENABLED = false' "$BUILD_CONFIG" || fail "hardware ejection is not disabled"
grep -q 'STRIPE_TERMINAL_USB_TEST_ENABLED = true' "$BUILD_CONFIG" || fail "USB Terminal lane disabled"
grep -q 'STRIPE_TERMINAL_SIMULATED_TEST_ENABLED = false' "$BUILD_CONFIG" || fail "simulated reader enabled"
grep -q 'com.stripe:stripeterminal:5.8.0' "$ROOT/android-kiosk/app/build.gradle.kts" || fail "Stripe 5.8.0 dependency missing"
grep -q 'processPaymentIntent' "$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java" || fail "processPaymentIntent missing"

echo "== 2/4 Verify installed app before touching it =="
SERIAL="${DTA_SERIAL:-$(pick_serial)}"
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || fail "DTA21269 ADB not connected"
echo "ADB device: $SERIAL"
TMP="$(mktemp -d /tmp/dta21269-sdk58-inplace.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
CURRENT_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" | head -1 | sed 's/^package://' | tr -d '\r')"
[[ -n "$CURRENT_PATH" ]] || fail "$PKG is not installed"
"$ADB" -s "$SERIAL" pull "$CURRENT_PATH" "$TMP/current.apk" >/dev/null
CURRENT_SIGNER="$(cert_sha "$TMP/current.apk")"
[[ -n "$CURRENT_SIGNER" ]] || fail "installed signer unavailable"
echo "Installed signer: $CURRENT_SIGNER"
[[ "$CURRENT_SIGNER" == "$NEW_SIGNER" ]] || fail "signer mismatch; refusing in-place update"

CURRENT_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG")"
CURRENT_CODE="$(printf '%s\n' "$CURRENT_DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
CURRENT_NAME="$(printf '%s\n' "$CURRENT_DUMP" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1 | tr -d '\r')"
[[ "$CURRENT_CODE" =~ ^[0-9]+$ ]] || fail "installed versionCode unavailable"
echo "Installed version: code=$CURRENT_CODE name=$CURRENT_NAME"
(( EXPECTED_VERSION_CODE > CURRENT_CODE )) || fail "new version is not upgrade-only"
echo "SIGNER_CONTINUITY_PASS"

echo "== 3/4 Install 5.8 in place; preserve app data =="
"$ADB" -s "$SERIAL" install -r "$APK"
"$ADB" -s "$SERIAL" shell pm grant "$PKG" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true
POST_DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG")"
printf '%s\n' "$POST_DUMP" | grep -q "versionCode=$EXPECTED_VERSION_CODE" || fail "installed versionCode mismatch after update"
printf '%s\n' "$POST_DUMP" | grep -q "versionName=$EXPECTED_VERSION_NAME" || fail "installed versionName mismatch after update"
POST_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" | head -1 | sed 's/^package://' | tr -d '\r')"
"$ADB" -s "$SERIAL" pull "$POST_PATH" "$TMP/post.apk" >/dev/null
POST_SIGNER="$(cert_sha "$TMP/post.apk")"
[[ "$POST_SIGNER" == "$CURRENT_SIGNER" ]] || fail "signer changed after update"
echo "INPLACE_UPDATE_PASS"

"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 1
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 3

echo "== 4/4 Non-financial WisePad 3 readiness =="
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null
READY=0
for attempt in $(seq 1 45); do
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-sdk58-window.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-sdk58-window.xml > "$TMP/window.xml" 2>/dev/null || true
  if python3 - "$TMP/window.xml" "$EXPECTED_SDK" <<'PY'
import json, sys, xml.etree.ElementTree as ET
path, expected = sys.argv[1:]
try:
    root=ET.parse(path).getroot()
except Exception:
    raise SystemExit(2)
payload=None
for node in root.iter('node'):
    text=node.attrib.get('text','')
    if text.startswith('{') and 'stripeTerminalReadiness' in text:
        try: payload=json.loads(text)
        except Exception: continue
        break
if not payload: raise SystemExit(3)
r=payload.get('stripeTerminalReadiness') or {}
d=r.get('diagnostics') or {}
ok=(
    d.get('stripeSdk')==expected and
    d.get('paymentApi')=='processPaymentIntent' and
    d.get('simulatedReader') is False and
    d.get('usbPresent') is True and
    d.get('usbPermission') is True and
    d.get('locationPermission') is True and
    r.get('readerState')=='READY' and
    r.get('capability')=='TERMINAL_AND_QR' and
    d.get('sdkConnectionStatus')=='CONNECTED'
)
if ok:
    print('READY')
    raise SystemExit(0)
print('waiting:', json.dumps({
    'readerState':r.get('readerState'),
    'capability':r.get('capability'),
    'stripeSdk':d.get('stripeSdk'),
    'sdkConnectionStatus':d.get('sdkConnectionStatus'),
    'usbPresent':d.get('usbPresent'),
    'usbPermission':d.get('usbPermission'),
    'locationPermission':d.get('locationPermission'),
    'paymentApi':d.get('paymentApi'),
    'errorCode':d.get('errorCode'),
}, separators=(',',':')))
raise SystemExit(4)
PY
  then
    READY=1
    break
  fi
  if (( attempt % 5 == 0 )); then echo "Readiness attempt $attempt/45"; fi
done

if [[ "$READY" != "1" ]]; then
  echo "ERROR: Stripe 5.8 WisePad readiness did not reach READY/CONNECTED" >&2
  "$ADB" -s "$SERIAL" logcat -d -t 500 | grep -E 'ChargeursStripe58|StripeTerminal' | tail -120 || true
  exit 21
fi

echo "SDK58_FIELD_READY_PASS"
echo "Installed: $EXPECTED_VERSION_NAME"
echo "Signer preserved: $POST_SIGNER"
echo "No payment or battery ejection was triggered by this script."
