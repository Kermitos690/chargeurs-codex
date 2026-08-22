#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REQUEST_FILE="${1:-$ROOT/ops/remote-request.json}"
OUT="$ROOT/ops-output"
mkdir -p "$OUT"
exec > >(tee "$OUT/run.log") 2>&1

json_field() {
  python3 - "$REQUEST_FILE" "$1" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
value = data.get(sys.argv[2], '')
print(value if isinstance(value, str) else '')
PY
}

ACTION="$(json_field action)"
STATION="$(json_field station)"
SOURCE_REF="$(json_field source_ref)"
REQUEST_ID="${GITHUB_RUN_ID:-local}"
CONFIG_DIR="$HOME/.chargeurs-remote"

[[ "$ACTION" =~ ^(adb_devices|adb_connect|kiosk_status|kiosk_version|kiosk_restart|kiosk_screenshot|kiosk_logcat|build_staging|install_staging|build_install_staging)$ ]] || {
  echo "Refusing unsupported action: $ACTION" >&2
  exit 64
}
[[ "$STATION" == "DTA21269" ]] || { echo "Refusing unapproved station" >&2; exit 64; }
[[ "$SOURCE_REF" =~ ^(main|hotfix/staging-terminal-cancel-v300|hotfix/staging-terminal-cancel-136)$ ]] || { echo "Source ref not allow-listed" >&2; exit 64; }

echo "request_id=$REQUEST_ID action=$ACTION station=$STATION source_ref=$SOURCE_REF"

find_adb() {
  local c
  for c in \
    "$(command -v adb 2>/dev/null || true)" \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "/opt/homebrew/bin/adb" \
    "/usr/local/bin/adb"; do
    if [[ -n "$c" && -x "$c" ]]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

ADB="$(find_adb || true)"

adb_required() {
  [[ -n "$ADB" ]] || { echo "adb not found on runner Mac" >&2; exit 69; }
}

connect_target_if_requested() {
  adb_required
  local target_file="$CONFIG_DIR/dta21269-adb-target"
  if [[ -r "$target_file" ]]; then
    local target
    target="$(tr -d '[:space:]' < "$target_file")"
    [[ "$target" =~ ^[0-9A-Fa-f:.]+:[0-9]{2,5}$ ]] || { echo "Invalid locally configured ADB target" >&2; exit 64; }
    "$ADB" connect "$target" || true
  fi
}

resolve_device() {
  adb_required
  connect_target_if_requested
  local device_file="$CONFIG_DIR/dta21269-adb-serial"
  if [[ -r "$device_file" ]]; then
    local configured
    configured="$(tr -d '[:space:]' < "$device_file")"
    [[ "$configured" =~ ^[A-Za-z0-9._:-]+$ ]] || { echo "Invalid locally configured ADB serial" >&2; exit 64; }
    "$ADB" -s "$configured" get-state | grep -qx device || { echo "Configured DTA21269 is not connected" >&2; exit 70; }
    printf '%s\n' "$configured"
    return 0
  fi
  local devices count chosen
  devices="$($ADB devices | awk 'NR>1 && $2=="device" {print $1}')"
  count="$(printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' ')"
  [[ "$count" == "1" ]] || {
    echo "Need exactly one connected ADB device when device is omitted; found $count" >&2
    "$ADB" devices -l || true
    exit 70
  }
  chosen="$(printf '%s\n' "$devices" | sed '/^$/d' | head -1)"
  printf '%s\n' "$chosen"
}

resolve_package() {
  local dev="$1" pkg="ch.chargeurs.kiosk.staging"
  if "$ADB" -s "$dev" shell pm path "$pkg" >/dev/null 2>&1; then
    printf '%s\n' "$pkg"
    return 0
  fi
  echo "Chargeurs STAGING kiosk package not found" >&2
  exit 71
}

checkout_source_ref() {
  git -C "$ROOT" fetch --no-tags origin "refs/heads/$SOURCE_REF:refs/remotes/origin/$SOURCE_REF"
  git -C "$ROOT" checkout --detach "refs/remotes/origin/$SOURCE_REF"
}

build_staging_apk() {
  checkout_source_ref
  grep -q 'HARDWARE_EJECTION_ENABLED", "false"' "$ROOT/android-kiosk/app/build.gradle.kts" || {
    echo "Refusing build: HARDWARE_EJECTION_ENABLED is not false" >&2; exit 72;
  }
  grep -q 'com.stripe:stripeterminal:3.0.0' "$ROOT/android-kiosk/app/build.gradle.kts" || {
    echo "Refusing build: Stripe Terminal 3.0.0 is not pinned" >&2; exit 72;
  }
  local sdk java
  sdk="$HOME/Library/Android/sdk"
  [[ -d "$sdk" ]] || { echo "Android SDK not found on runner" >&2; exit 72; }
  java="$(/usr/libexec/java_home -v 17 2>/dev/null)/bin/java"
  [[ -x "$java" ]] || { echo "Java 17 not found on runner" >&2; exit 72; }
  (
    cd "$ROOT/android-kiosk"
    printf 'sdk.dir=%s\n' "$sdk" > local.properties
    "$java" -Dorg.gradle.appname=gradlew -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain --no-daemon clean testDebugUnitTest lintStaging assembleStaging
  )
  local apk="$ROOT/android-kiosk/app/build/outputs/apk/staging/app-staging.apk"
  [[ -s "$apk" ]] || { echo "staging APK missing after build" >&2; exit 72; }
  cp "$apk" "$OUT/app-staging.apk"
  shasum -a 256 "$OUT/app-staging.apk" | tee "$OUT/app-staging.sha256"
}

find_apksigner_jar() {
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  find "$sdk/build-tools" -type f -path '*/lib/apksigner.jar' 2>/dev/null | sort | tail -1
}

verify_and_install_upgrade() {
  local dev="$1" pkg="$2" apk="$OUT/app-staging.apk"
  local apksigner_jar java aapt installed_path installed_apk new_cert old_cert new_pkg new_code new_name old_code
  apksigner_jar="$(find_apksigner_jar)"
  java="$(/usr/libexec/java_home -v 17 2>/dev/null)/bin/java"
  aapt="$(find "$HOME/Library/Android/sdk/build-tools" -type f -name aapt -perm -u+x 2>/dev/null | sort | tail -1)"
  [[ -r "$apksigner_jar" && -x "$java" && -x "$aapt" ]] || { echo "Android APK verification tools not found" >&2; exit 73; }

  local badging
  badging="$($aapt dump badging "$apk")"
  new_pkg="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" <<< "$badging")"
  new_code="$(sed -n "s/^package:.*versionCode='\([0-9]*\)'.*/\1/p" <<< "$badging")"
  new_name="$(sed -n "s/^package:.*versionName='\([^']*\)'.*/\1/p" <<< "$badging")"
  [[ "$new_pkg" == "ch.chargeurs.kiosk.staging" && "$new_name" == *-staging && "$new_code" =~ ^[0-9]+$ ]] || {
    echo "Refusing non-STAGING APK" >&2; exit 74;
  }

  installed_path="$($ADB -s "$dev" shell pm path "$pkg" | head -1 | sed 's/^package://;s/\r$//')"
  [[ -n "$installed_path" ]] || { echo "installed APK path not found" >&2; exit 75; }
  old_code="$($ADB -s "$dev" shell dumpsys package "$pkg" | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -1)"
  [[ "$old_code" =~ ^[0-9]+$ && "$new_code" -gt "$old_code" ]] || {
    echo "Refusing non-upgrade APK: new=$new_code installed=$old_code" >&2; exit 76;
  }
  installed_apk="$OUT/installed-current.apk"
  "$ADB" -s "$dev" pull "$installed_path" "$installed_apk" >/dev/null

  "$java" -jar "$apksigner_jar" verify --print-certs "$apk" > "$OUT/new-apk-cert.txt"
  "$java" -jar "$apksigner_jar" verify --print-certs "$installed_apk" > "$OUT/installed-apk-cert.txt"
  new_cert="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$OUT/new-apk-cert.txt" | head -1 | tr '[:upper:]' '[:lower:]')"
  old_cert="$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$OUT/installed-apk-cert.txt" | head -1 | tr '[:upper:]' '[:lower:]')"
  echo "new_signer=$new_cert"
  echo "installed_signer=$old_cert"
  [[ -n "$new_cert" && "$new_cert" == "$old_cert" ]] || {
    echo "Signer mismatch: refusing installation; app will NOT be uninstalled" >&2
    exit 75
  }

  "$ADB" -s "$dev" install -r "$apk"
  "$ADB" -s "$dev" shell dumpsys package "$pkg" | grep -E 'versionName=|versionCode=' | head -10 | tee "$OUT/installed-version.txt" || true
}

case "$ACTION" in
  adb_devices)
    adb_required
    "$ADB" devices -l
    ;;
  adb_connect)
    adb_required
    [[ -r "$CONFIG_DIR/dta21269-adb-target" ]] || { echo "No local DTA21269 ADB target is configured" >&2; exit 64; }
    connect_target_if_requested
    "$ADB" devices -l
    ;;
  kiosk_status)
    dev="$(resolve_device)"
    pkg="$(resolve_package "$dev")"
    echo "device=$dev package=$pkg"
    "$ADB" devices -l
    "$ADB" -s "$dev" shell dumpsys package "$pkg" | grep -E 'versionName=|versionCode=' | head -10 || true
    "$ADB" -s "$dev" shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | head -20 || true
    ;;
  kiosk_version)
    dev="$(resolve_device)"
    pkg="$(resolve_package "$dev")"
    "$ADB" -s "$dev" shell dumpsys package "$pkg" | grep -E 'versionName=|versionCode=' | head -10 || true
    ;;
  kiosk_restart)
    dev="$(resolve_device)"
    pkg="$(resolve_package "$dev")"
    echo "Restarting $pkg on $dev"
    "$ADB" -s "$dev" shell am force-stop "$pkg"
    "$ADB" -s "$dev" shell am start -n "$pkg/.MainActivity"
    sleep 2
    "$ADB" -s "$dev" shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | head -20 || true
    ;;
  kiosk_screenshot)
    dev="$(resolve_device)"
    "$ADB" -s "$dev" exec-out screencap -p > "$OUT/kiosk-screen.png"
    ;;
  kiosk_logcat)
    dev="$(resolve_device)"
    echo "Collecting filtered Chargeurs/Stripe/Terminal logcat from $dev"
    "$ADB" -s "$dev" logcat -d -T '10m' | grep -Ei 'chargeurs|stripe|terminal|wisepad|reader|paymentintent|cancel|engaged|busy' | tail -n 1200 | tee "$OUT/logcat-filtered.txt" || true
    ;;
  build_staging)
    build_staging_apk
    ;;
  install_staging)
    dev="$(resolve_device)"
    pkg="$(resolve_package "$dev")"
    [[ -s "$OUT/app-staging.apk" ]] || { echo "No locally built STAGING APK available to install" >&2; exit 72; }
    verify_and_install_upgrade "$dev" "$pkg"
    ;;
  build_install_staging)
    dev="$(resolve_device)"
    pkg="$(resolve_package "$dev")"
    echo "Building $SOURCE_REF then upgrading $pkg on $dev"
    build_staging_apk
    verify_and_install_upgrade "$dev" "$pkg"
    ;;
esac
