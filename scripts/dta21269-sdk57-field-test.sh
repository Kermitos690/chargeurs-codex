#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BRANCH="fix/dta21269-terminal-sdk-5-7"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_VERSION_CODE="157"
EXPECTED_VERSION_NAME="1.0.57-terminal-sdk570-reconnect-staging"
EXPECTED_SIGNER="b37d4cda37c8623259dfc7aa408328b8f2d04911082c46073b6e1b429ba805a3"
EXPECTED_SDK="5.7.0-test-only"

ROOT="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current)"
if [[ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]]; then
  echo "ERROR: expected branch $EXPECTED_BRANCH, got $CURRENT_BRANCH" >&2
  exit 2
fi

# Gradle/AGP requires a real JDK. Prefer an already installed JDK 17+, then
# bootstrap an isolated Temurin 21 into the user's cache. Nothing is installed
# system-wide and no sudo/admin access is required.
java_major_for_home() {
  local home="$1" version major rest
  [[ -x "$home/bin/java" ]] || return 1
  version="$("$home/bin/java" -version 2>&1 | sed -n '1s/.*version "\([^"]*\)".*/\1/p')"
  [[ -n "$version" ]] || return 1
  major="${version%%.*}"
  if [[ "$major" == "1" ]]; then
    rest="${version#1.}"
    major="${rest%%.*}"
  fi
  [[ "$major" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$major"
}

pick_java_home() {
  local candidate major
  local -a candidates=()

  [[ -n "${JAVA_HOME:-}" ]] && candidates+=("$JAVA_HOME")
  candidates+=(
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home"
    "$HOME/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    "$HOME/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home"
  )

  for candidate in /Library/Java/JavaVirtualMachines/*/Contents/Home; do
    [[ -d "$candidate" ]] && candidates+=("$candidate")
  done
  for candidate in "$HOME"/Library/Java/JavaVirtualMachines/*/Contents/Home; do
    [[ -d "$candidate" ]] && candidates+=("$candidate")
  done
  for candidate in "$HOME"/Library/Caches/chargeurs-jdk/temurin21-*/unpack/*/Contents/Home; do
    [[ -d "$candidate" ]] && candidates+=("$candidate")
  done

  for candidate in "${candidates[@]}"; do
    major="$(java_major_for_home "$candidate" || true)"
    if [[ -n "$major" && "$major" -ge 17 ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

bootstrap_temurin21() {
  command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required to bootstrap Java" >&2; return 1; }
  command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required to verify Temurin metadata" >&2; return 1; }
  command -v shasum >/dev/null 2>&1 || { echo "ERROR: shasum is required to verify Temurin" >&2; return 1; }

  local machine arch cache meta download_url expected_sha archive actual_sha home
  machine="$(uname -m)"
  case "$machine" in
    arm64|aarch64) arch="aarch64" ;;
    x86_64|amd64) arch="x64" ;;
    *) echo "ERROR: unsupported macOS architecture: $machine" >&2; return 1 ;;
  esac

  cache="$HOME/Library/Caches/chargeurs-jdk/temurin21-$arch"
  home="$(find "$cache/unpack" -type f -path '*/Contents/Home/bin/java' -print -quit 2>/dev/null | sed 's#/bin/java$##' || true)"
  if [[ -n "$home" ]] && [[ "$(java_major_for_home "$home" || true)" -ge 17 ]]; then
    printf '%s' "$home"
    return 0
  fi

  mkdir -p "$cache"
  meta="$cache/assets.json"
  archive="$cache/temurin21.tar.gz"

  echo "No JDK 17+ found; downloading a verified local Eclipse Temurin 21 JDK ($arch)..." >&2
  curl -fsSL --retry 3 --retry-delay 2 \
    "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=$arch&image_type=jdk&os=mac&vendor=eclipse&heap_size=normal" \
    -o "$meta"

  download_url="$(python3 - "$meta" <<'PY'
import json, sys
assets=json.load(open(sys.argv[1], encoding='utf-8'))
if not assets:
    raise SystemExit(2)
print(assets[0]['binary']['package']['link'])
PY
)"
  expected_sha="$(python3 - "$meta" <<'PY'
import json, sys
assets=json.load(open(sys.argv[1], encoding='utf-8'))
if not assets:
    raise SystemExit(2)
print(assets[0]['binary']['package']['checksum'].lower())
PY
)"
  [[ "$expected_sha" =~ ^[0-9a-f]{64}$ ]] || { echo "ERROR: invalid Temurin checksum metadata" >&2; return 1; }

  curl -fL --retry 3 --retry-delay 2 "$download_url" -o "$archive"
  actual_sha="$(shasum -a 256 "$archive" | awk '{print tolower($1)}')"
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "ERROR: Temurin SHA-256 verification failed" >&2
    echo "actual=$actual_sha expected=$expected_sha" >&2
    rm -f "$archive"
    return 1
  fi
  echo "Temurin SHA-256 verified: $actual_sha" >&2

  rm -rf "$cache/unpack"
  mkdir -p "$cache/unpack"
  tar -xzf "$archive" -C "$cache/unpack"
  home="$(find "$cache/unpack" -type f -path '*/Contents/Home/bin/java' -print -quit | sed 's#/bin/java$##')"
  [[ -n "$home" ]] || { echo "ERROR: Temurin archive did not contain a macOS JDK home" >&2; return 1; }
  [[ "$(java_major_for_home "$home" || true)" -ge 17 ]] || { echo "ERROR: downloaded Temurin is not JDK 17+" >&2; return 1; }
  printf '%s' "$home"
}

JAVA_HOME="$(pick_java_home || true)"
if [[ -z "$JAVA_HOME" ]]; then
  JAVA_HOME="$(bootstrap_temurin21 || true)"
fi
if [[ -z "$JAVA_HOME" ]]; then
  echo "ERROR: unable to obtain a JDK 17+ for the build." >&2
  echo "JAVA_REQUIRED_FOR_BUILD" >&2
  exit 22
fi
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
JAVA_MAJOR="$(java_major_for_home "$JAVA_HOME")"
echo "Java: $JAVA_HOME (major $JAVA_MAJOR)"

ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
find_build_tool() {
  local name="$1"
  find "$ANDROID_HOME/build-tools" -type f -name "$name" 2>/dev/null | sort -V | tail -1
}
APKSIGNER="$(find_build_tool apksigner)"
AAPT="$(find_build_tool aapt)"
[[ -x "$APKSIGNER" ]] || { echo "ERROR: apksigner not found" >&2; exit 4; }
[[ -x "$AAPT" ]] || { echo "ERROR: aapt not found" >&2; exit 5; }

TMP="$(mktemp -d /tmp/dta21269-sdk57.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

cert_sha() {
  "$APKSIGNER" verify --print-certs "$1" \
    | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    | head -1 \
    | tr '[:upper:]' '[:lower:]' \
    | tr -d ':'
}

export CHARGEURS_STAGING_KEYSTORE_PATH="${CHARGEURS_STAGING_KEYSTORE_PATH:-$HOME/.android/debug.keystore}"
export CHARGEURS_STAGING_KEYSTORE_PASSWORD="${CHARGEURS_STAGING_KEYSTORE_PASSWORD:-android}"
export CHARGEURS_STAGING_KEY_ALIAS="${CHARGEURS_STAGING_KEY_ALIAS:-androiddebugkey}"
export CHARGEURS_STAGING_KEY_PASSWORD="${CHARGEURS_STAGING_KEY_PASSWORD:-android}"
[[ -f "$CHARGEURS_STAGING_KEYSTORE_PATH" ]] || {
  echo "ERROR: staging keystore not found at $CHARGEURS_STAGING_KEYSTORE_PATH" >&2
  exit 9
}

cd "$ROOT/android-kiosk"

echo "== Phase 1/2: build + static safety gates =="
echo "== Dependency resolution =="
./gradlew --no-daemon -q :app:dependencies --configuration stagingRuntimeClasspath > "$TMP/deps.txt"
grep -q 'com.stripe:stripeterminal:5.7.0' "$TMP/deps.txt" || {
  echo "ERROR: staging runtime classpath does not resolve Stripe Terminal 5.7.0" >&2
  exit 10
}

echo "== Unit tests + lint + APK build =="
./gradlew --no-daemon clean :app:testStagingUnitTest :app:lintStaging :app:assembleStaging

APK="$ROOT/android-kiosk/app/build/outputs/apk/staging/app-staging.apk"
[[ -f "$APK" ]] || { echo "ERROR: staging APK not produced" >&2; exit 11; }

BADGING="$($AAPT dump badging "$APK" | head -1)"
echo "$BADGING" | grep -q "versionCode='$EXPECTED_VERSION_CODE'" || {
  echo "ERROR: wrong APK versionCode" >&2
  echo "$BADGING" >&2
  exit 12
}
echo "$BADGING" | grep -q "versionName='$EXPECTED_VERSION_NAME'" || {
  echo "ERROR: wrong APK versionName" >&2
  echo "$BADGING" >&2
  exit 13
}

NEW_SIGNER="$(cert_sha "$APK")"
[[ "$NEW_SIGNER" == "$EXPECTED_SIGNER" ]] || {
  echo "ERROR: new APK signer is not the canonical DTA21269 staging signer" >&2
  echo "new=$NEW_SIGNER expected=$EXPECTED_SIGNER" >&2
  exit 14
}

BUILD_CONFIG="$(find "$ROOT/android-kiosk/app/build/generated" -type f -path '*/staging/*/ch/chargeurs/kiosk/BuildConfig.java' | head -1 || true)"
[[ -f "$BUILD_CONFIG" ]] || { echo "ERROR: generated staging BuildConfig not found" >&2; exit 15; }
grep -q 'HARDWARE_EJECTION_ENABLED = false' "$BUILD_CONFIG" || { echo "ERROR: ejection is not fail-closed" >&2; exit 16; }
grep -q 'STRIPE_TERMINAL_USB_TEST_ENABLED = true' "$BUILD_CONFIG" || { echo "ERROR: physical Terminal lane is not enabled" >&2; exit 17; }
grep -q 'STRIPE_TERMINAL_SIMULATED_TEST_ENABLED = false' "$BUILD_CONFIG" || { echo "ERROR: simulator unexpectedly enabled" >&2; exit 18; }

echo "SDK57_PREINSTALL_PASS"
echo "APK: $APK"
echo "Signer: $NEW_SIGNER"

echo "== Phase 2/2: DTA21269 ADB install + physical readiness =="
ADB="$(command -v adb || true)"
[[ -n "$ADB" ]] || ADB="$ANDROID_HOME/platform-tools/adb"
[[ -x "$ADB" ]] || { echo "ERROR: adb not found" >&2; exit 3; }

pick_serial() {
  local serial endpoint
  serial="$("$ADB" devices | awk '$2=="device" && $1 ~ /^[0-9]+\./ {print $1; exit}')"
  [[ -n "$serial" ]] || serial="$("$ADB" devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  if [[ -z "$serial" ]]; then
    endpoint="$("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | head -1 || true)"
    if [[ -n "$endpoint" ]]; then
      "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
      if "$ADB" -s "$endpoint" get-state >/dev/null 2>&1; then serial="$endpoint"; fi
    fi
  fi
  printf '%s' "$serial"
}

SERIAL="${DTA_SERIAL:-$(pick_serial)}"
if [[ -z "$SERIAL" ]] || ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  echo "ADB_REQUIRED_AFTER_BUILD"
  echo "APK_ALREADY_BUILT=$APK"
  echo "Open Android > Wireless debugging, note the current IP:port, then rerun:" >&2
  echo "  DTA_SERIAL=IP:PORT bash scripts/dta21269-sdk57-field-test.sh" >&2
  exit 6
fi
printf 'ADB device: %s\n' "$SERIAL"

CURRENT_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" | head -1 | sed 's/^package://' | tr -d '\r')"
[[ -n "$CURRENT_PATH" ]] || { echo "ERROR: $PKG is not installed" >&2; exit 7; }
"$ADB" -s "$SERIAL" pull "$CURRENT_PATH" "$TMP/current.apk" >/dev/null
CURRENT_SIGNER="$(cert_sha "$TMP/current.apk")"
[[ "$CURRENT_SIGNER" == "$EXPECTED_SIGNER" && "$CURRENT_SIGNER" == "$NEW_SIGNER" ]] || {
  echo "ERROR: installed APK signer does not match new/canonical signer" >&2
  echo "installed=$CURRENT_SIGNER new=$NEW_SIGNER expected=$EXPECTED_SIGNER" >&2
  exit 8
}

echo "== Installing in-place on DTA21269 =="
"$ADB" -s "$SERIAL" install -r "$APK"
"$ADB" -s "$SERIAL" shell am force-stop "$PKG"
sleep 2
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 4

DUMPSYS="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG")"
echo "$DUMPSYS" | grep -q "versionCode=$EXPECTED_VERSION_CODE" || { echo "ERROR: installed versionCode mismatch" >&2; exit 19; }
echo "$DUMPSYS" | grep -q "versionName=$EXPECTED_VERSION_NAME" || { echo "ERROR: installed versionName mismatch" >&2; exit 20; }

echo "== Non-financial WisePad readiness gate =="
"$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null

READY=0
for attempt in $(seq 1 15); do
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-window.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-window.xml > "$TMP/window.xml" 2>/dev/null || true
  if python3 - "$TMP/window.xml" "$EXPECTED_SDK" <<'PY'
import json, sys, xml.etree.ElementTree as ET
path, expected_sdk = sys.argv[1], sys.argv[2]
try:
    root = ET.parse(path).getroot()
    payload = None
    for node in root.iter('node'):
        text = node.attrib.get('text', '')
        if text.startswith('{') and 'stripeTerminalReadiness' in text:
            payload = json.loads(text)
            break
    if payload is None:
        raise SystemExit(2)
    r = payload['stripeTerminalReadiness']; d = r['diagnostics']
    summary = {k:v for k,v in {
        'appVersion': payload.get('appVersion'), 'readerState': r.get('readerState'),
        'capability': r.get('capability'), 'stripeSdk': d.get('stripeSdk'),
        'sdkConnectionStatus': d.get('sdkConnectionStatus'), 'usbPresent': d.get('usbPresent'),
        'usbPermission': d.get('usbPermission'), 'locationPermission': d.get('locationPermission'),
        'simulatedReader': d.get('simulatedReader'), 'stripeReaderId': d.get('stripeReaderId'),
        'expectedReaderId': d.get('expectedReaderId'), 'errorCode': d.get('errorCode')}.items()}
    print(json.dumps(summary, separators=(',', ':')))
    ok = (d.get('stripeSdk') == expected_sdk and d.get('usbPresent') is True
          and d.get('usbPermission') is True and d.get('locationPermission') is True
          and d.get('simulatedReader') is False and r.get('readerState') == 'READY'
          and r.get('capability') == 'TERMINAL_AND_QR'
          and d.get('sdkConnectionStatus') == 'CONNECTED' and not d.get('errorCode'))
    raise SystemExit(0 if ok else 3)
except Exception as exc:
    print('diagnostic-parse-error:' + repr(exc))
    raise SystemExit(4)
PY
  then READY=1; break; fi
done

if [[ "$READY" != "1" ]]; then
  echo "ERROR: WisePad did not reach READY / TERMINAL_AND_QR within 30 seconds" >&2
  "$ADB" -s "$SERIAL" logcat -d -v time | grep -E 'ChargeursStripe57|StripeTerminal' | tail -n 220 || true
  exit 21
fi

"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null

echo "SDK57_FIELD_READY_PASS"
echo "Build/tests/lint/signature/install/readiness passed. Cancellation cycles and cold-reboot recovery remain physical acceptance steps."
