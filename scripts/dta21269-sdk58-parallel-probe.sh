#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BRANCH="fix/dta21269-terminal-sdk-5-7"
OLD_PKG="ch.chargeurs.kiosk.staging"
NEW_PKG="ch.chargeurs.kiosk.sdk58probe"
EXPECTED_OLD_SIGNER="b37d4cda37c8623259dfc7aa408328b8f2d04911082c46073b6e1b429ba805a3"
EXPECTED_SDK="5.8.0-test-only"
ROOT="$(git rev-parse --show-toplevel)"
CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current)"
[[ "$CURRENT_BRANCH" == "$EXPECTED_BRANCH" ]] || {
  echo "ERROR: expected branch $EXPECTED_BRANCH, got $CURRENT_BRANCH" >&2
  exit 2
}

umask 077
TMP="$(mktemp -d /tmp/dta21269-sdk58-probe.XXXXXX)"
SERIAL=""
OLD_STOPPED=0
KEEP_PROBE=0

cleanup() {
  local status=$?
  rm -rf "$TMP" || true
  if [[ "$status" != "0" && "$OLD_STOPPED" == "1" && -n "$SERIAL" && "${ADB:-}" != "" ]]; then
    echo "Probe failed; restoring canonical staging app..." >&2
    "$ADB" -s "$SERIAL" shell am force-stop "$NEW_PKG" >/dev/null 2>&1 || true
    "$ADB" -s "$SERIAL" shell monkey -p "$OLD_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

resolve_java_home() {
  local candidate
  for candidate in \
    "${JAVA_HOME:-}" \
    "$HOME/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/jdk-21.0.12.1+1/Contents/Home" \
    "$HOME/Library/Caches/chargeurs-jdk/temurin21-aarch64/unpack/jdk-21.0.12.1+1/Contents/Home" \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  do
    [[ -n "$candidate" && -x "$candidate/bin/java" ]] || continue
    local major
    major="$("$candidate/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9][0-9]*\).*/\1/p')"
    if [[ "$major" =~ ^[0-9]+$ ]] && [[ "$major" -ge 17 ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  candidate="$(find "$HOME/Library/Caches/chargeurs-jdk" -type f -path '*/Contents/Home/bin/java' -print -quit 2>/dev/null | sed 's#/bin/java$##' || true)"
  [[ -n "$candidate" && -x "$candidate/bin/java" ]] && { printf '%s' "$candidate"; return 0; }
  return 1
}

resolve_android_sdk() {
  local candidate adb_path real
  for candidate in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk"; do
    [[ -n "$candidate" && -d "$candidate/build-tools" && -x "$candidate/platform-tools/adb" ]] || continue
    printf '%s' "$candidate"
    return 0
  done
  adb_path="$(command -v adb || true)"
  if [[ -n "$adb_path" ]]; then
    real="$(python3 - "$adb_path" <<'PY'
import os,sys
print(os.path.realpath(sys.argv[1]))
PY
)"
    if [[ "$real" == */platform-tools/adb ]]; then
      candidate="${real%/platform-tools/adb}"
      [[ -d "$candidate/build-tools" ]] && { printf '%s' "$candidate"; return 0; }
    fi
  fi
  return 1
}

JAVA_HOME="$(resolve_java_home || true)"
[[ -n "$JAVA_HOME" ]] || { echo "ERROR: JDK 17+ not found" >&2; exit 3; }
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
ANDROID_HOME="$(resolve_android_sdk || true)"
[[ -n "$ANDROID_HOME" ]] || { echo "ERROR: Android SDK not found" >&2; exit 4; }
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
ADB="$ANDROID_HOME/platform-tools/adb"

find_build_tool() {
  local name="$1"
  find "$ANDROID_HOME/build-tools" -type f -name "$name" -perm -u+x 2>/dev/null | sort -V | tail -1
}
APKSIGNER="$(find_build_tool apksigner)"
AAPT="$(find_build_tool aapt)"
[[ -x "$APKSIGNER" && -x "$AAPT" ]] || { echo "ERROR: Android build tools missing" >&2; exit 5; }

cert_sha() {
  "$APKSIGNER" verify --print-certs "$1" \
    | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' \
    | head -1 | tr '[:upper:]' '[:lower:]' | tr -d ':'
}

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

cat > "$ROOT/android-kiosk/local.properties" <<EOF
sdk.dir=$ANDROID_HOME
EOF

cd "$ROOT/android-kiosk"
echo "== SDK 5.8 parallel probe: build =="
./gradlew --no-daemon -q :app:dependencies --configuration sdk58ProbeRuntimeClasspath > "$TMP/deps.txt"
grep -q 'com.stripe:stripeterminal:5.8.0' "$TMP/deps.txt" || {
  echo "ERROR: sdk58Probe does not resolve Stripe Terminal 5.8.0" >&2; exit 6;
}
RUNTIME="$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java"
grep -q 'processPaymentIntent' "$RUNTIME" || { echo "ERROR: processPaymentIntent missing" >&2; exit 7; }

TASKS="$(./gradlew --no-daemon -q :app:tasks --all)"
grep -Eq '^[[:space:]]*assembleSdk58Probe([[:space:]-]|$)' <<<"$TASKS" || {
  echo "ERROR: assembleSdk58Probe task missing" >&2; exit 8;
}
if grep -Eq '^[[:space:]]*lintSdk58Probe([[:space:]-]|$)' <<<"$TASKS"; then
  LINT_TASK=":app:lintSdk58Probe"
else
  LINT_TASK=":app:lintDebug"
fi
./gradlew --no-daemon clean :app:testDebugUnitTest "$LINT_TASK" :app:assembleSdk58Probe

APK="$(find "$ROOT/android-kiosk/app/build/outputs/apk/sdk58Probe" -maxdepth 1 -type f -name '*.apk' -print -quit 2>/dev/null || true)"
[[ -f "$APK" ]] || { echo "ERROR: sdk58Probe APK not produced" >&2; exit 9; }
BADGING="$($AAPT dump badging "$APK" | head -1)"
echo "$BADGING" | grep -q "package: name='$NEW_PKG'" || { echo "ERROR: wrong probe package" >&2; exit 10; }
echo "$BADGING" | grep -q "staging-diagnostic'" || { echo "ERROR: wrong probe versionName" >&2; exit 11; }
NEW_SIGNER="$(cert_sha "$APK")"
[[ -n "$NEW_SIGNER" ]] || { echo "ERROR: probe signer unavailable" >&2; exit 12; }

echo "Probe APK built: $(basename "$APK")"
echo "Probe signer: $NEW_SIGNER"

SERIAL="${DTA_SERIAL:-$(pick_serial)}"
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || {
  echo "ERROR: DTA21269 ADB device not connected" >&2
  echo "Set DTA_SERIAL=IP:PORT after enabling Wireless debugging." >&2
  exit 13
}
echo "ADB device: $SERIAL"

# Protect the canonical app before any probe installation.
OLD_PATH="$("$ADB" -s "$SERIAL" shell pm path "$OLD_PKG" | head -1 | sed 's/^package://' | tr -d '\r')"
[[ -n "$OLD_PATH" ]] || { echo "ERROR: canonical staging app is not installed" >&2; exit 14; }
"$ADB" -s "$SERIAL" pull "$OLD_PATH" "$TMP/old.apk" >/dev/null
OLD_SIGNER="$(cert_sha "$TMP/old.apk")"
[[ "$OLD_SIGNER" == "$EXPECTED_OLD_SIGNER" ]] || {
  echo "ERROR: installed canonical app signer changed; refusing probe" >&2
  exit 15
}
"$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" id >/dev/null 2>&1 || {
  echo "ERROR: canonical app is not accessible with run-as; refusing token migration" >&2
  exit 16
}

echo "Canonical app verified; reading only its encrypted staging configuration..."
"$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" cat shared_prefs/chargeurs_kiosk_config.xml \
  | tr -d '\r' > "$TMP/old-prefs.xml"
python3 - "$TMP/old-prefs.xml" "$TMP/meta.tsv" <<'PY'
import sys, xml.etree.ElementTree as ET
src,out=sys.argv[1:]
root=ET.parse(src).getroot()
values={node.attrib.get('name'): (node.text or '') for node in root if node.tag=='string'}
required=['station_id','base_url','token_cipher','token_iv','token_crypto_mode','legacy_device_salt']
missing=[k for k in required if not values.get(k)]
if missing:
    raise SystemExit('ERROR: old config missing: '+','.join(missing))
if values['token_crypto_mode']!='LEGACY_DEVICE_BOUND':
    raise SystemExit('ERROR: old config is not LEGACY_DEVICE_BOUND; refusing unsafe migration')
with open(out,'w',encoding='utf-8') as f:
    f.write('\t'.join(values[k] for k in required)+'\n')
PY
IFS=$'\t' read -r STATION_ID BASE_URL OLD_CIPHER OLD_IV OLD_MODE OLD_SALT < "$TMP/meta.tsv"

OLD_ANDROID_ID="$("$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" settings get secure android_id 2>/dev/null | tr -d '\r\n')"
[[ "$OLD_ANDROID_ID" =~ ^[A-Za-z0-9_-]{8,128}$ ]] || {
  echo "ERROR: could not read app-scoped Android ID from canonical app" >&2
  exit 17
}

# Remove only an earlier probe package. The canonical staging package is never uninstalled.
if "$ADB" -s "$SERIAL" shell pm path "$NEW_PKG" | grep -q '^package:'; then
  echo "Removing previous side-by-side probe package only..."
  "$ADB" -s "$SERIAL" uninstall "$NEW_PKG" >/dev/null
fi

echo "Installing side-by-side SDK 5.8 probe (canonical app remains installed)..."
"$ADB" -s "$SERIAL" install "$APK" >/dev/null
"$ADB" -s "$SERIAL" shell run-as "$NEW_PKG" id >/dev/null 2>&1 || {
  echo "ERROR: new probe is not debuggable/run-as capable" >&2
  exit 18
}
NEW_ANDROID_ID="$("$ADB" -s "$SERIAL" shell run-as "$NEW_PKG" settings get secure android_id 2>/dev/null | tr -d '\r\n')"
[[ "$NEW_ANDROID_ID" =~ ^[A-Za-z0-9_-]{8,128}$ ]] || {
  echo "ERROR: could not read app-scoped Android ID from probe" >&2
  exit 19
}

cat > "$TMP/LegacyConfigRewrap.java" <<'JAVA'
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public class LegacyConfigRewrap {
  static byte[] hex(String value) {
    if ((value.length() & 1) != 0) throw new IllegalArgumentException("bad hex");
    byte[] out=new byte[value.length()/2];
    for(int i=0;i<out.length;i++) out[i]=(byte)Integer.parseInt(value.substring(i*2,i*2+2),16);
    return out;
  }
  static byte[] key(String pkg,String androidId,String signerHex,byte[] salt) throws Exception {
    MessageDigest d=MessageDigest.getInstance("SHA-256");
    d.update("chargeurs-kiosk-staging-device-bound-v1".getBytes(StandardCharsets.UTF_8)); d.update((byte)0);
    d.update(pkg.getBytes(StandardCharsets.UTF_8)); d.update((byte)0);
    d.update(androidId.trim().getBytes(StandardCharsets.UTF_8)); d.update((byte)0);
    d.update(hex(signerHex)); d.update((byte)0); d.update(salt);
    return d.digest();
  }
  static String esc(String s) {
    return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&apos;");
  }
  public static void main(String[] a) throws Exception {
    if(a.length!=11) throw new IllegalArgumentException("args");
    String oldPkg=a[0],oldId=a[1],oldSigner=a[2],station=a[3],base=a[4],cipherB64=a[5],ivB64=a[6],saltB64=a[7];
    String newPkg=a[8],newId=a[9],newSigner=a[10];
    Base64.Decoder dec=Base64.getDecoder(); Base64.Encoder enc=Base64.getEncoder();
    byte[] oldKey=key(oldPkg,oldId,oldSigner,dec.decode(saltB64));
    Cipher decrypt=Cipher.getInstance("AES/GCM/NoPadding");
    decrypt.init(Cipher.DECRYPT_MODE,new SecretKeySpec(oldKey,"AES"),new GCMParameterSpec(128,dec.decode(ivB64)));
    String token=new String(decrypt.doFinal(dec.decode(cipherB64)),StandardCharsets.UTF_8);
    if(!Pattern.matches("^[A-Za-z0-9._~-]{16,512}$",token)) throw new IllegalStateException("token validation failed");
    byte[] newSalt=new byte[32]; new SecureRandom().nextBytes(newSalt);
    byte[] newKey=key(newPkg,newId,newSigner,newSalt);
    Cipher encrypt=Cipher.getInstance("AES/GCM/NoPadding");
    encrypt.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(newKey,"AES"));
    byte[] newCipher=encrypt.doFinal(token.getBytes(StandardCharsets.UTF_8));
    token=null;
    System.out.print("<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n");
    System.out.print("<string name=\"station_id\">"+esc(station)+"</string>\n");
    System.out.print("<string name=\"base_url\">"+esc(base)+"</string>\n");
    System.out.print("<string name=\"token_cipher\">"+enc.encodeToString(newCipher)+"</string>\n");
    System.out.print("<string name=\"token_iv\">"+enc.encodeToString(encrypt.getIV())+"</string>\n");
    System.out.print("<string name=\"token_crypto_mode\">LEGACY_DEVICE_BOUND</string>\n");
    System.out.print("<string name=\"legacy_device_salt\">"+enc.encodeToString(newSalt)+"</string>\n</map>\n");
  }
}
JAVA

# Decrypt old token and immediately re-encrypt for the probe. Stdout is piped
# directly into the probe's private sandbox; plaintext is never printed or saved.
echo "Rewrapping encrypted kiosk configuration for the probe..."
"$JAVA_HOME/bin/java" "$TMP/LegacyConfigRewrap.java" \
  "$OLD_PKG" "$OLD_ANDROID_ID" "$OLD_SIGNER" "$STATION_ID" "$BASE_URL" \
  "$OLD_CIPHER" "$OLD_IV" "$OLD_SALT" \
  "$NEW_PKG" "$NEW_ANDROID_ID" "$NEW_SIGNER" \
  | "$ADB" -s "$SERIAL" shell run-as "$NEW_PKG" sh -c \
      'mkdir -p shared_prefs; umask 077; cat > shared_prefs/chargeurs_kiosk_config.xml; chmod 600 shared_prefs/chargeurs_kiosk_config.xml'

# Verify the old app still exists before releasing USB ownership.
"$ADB" -s "$SERIAL" shell pm path "$OLD_PKG" | grep -q '^package:' || {
  echo "ERROR: canonical app disappeared; refusing to continue" >&2; exit 20;
}

echo "Temporarily stopping canonical app to release WisePad USB (data remains untouched)..."
"$ADB" -s "$SERIAL" shell am force-stop "$OLD_PKG"
OLD_STOPPED=1
"$ADB" -s "$SERIAL" shell am force-stop "$NEW_PKG" || true
"$ADB" -s "$SERIAL" shell monkey -p "$NEW_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 5

# The exported diagnostic activity is enabled only for diagnostic builds.
"$ADB" -s "$SERIAL" shell am start -n "$NEW_PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null
READY=0
for attempt in $(seq 1 20); do
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-sdk58-probe.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-sdk58-probe.xml > "$TMP/window.xml" 2>/dev/null || true
  if python3 - "$TMP/window.xml" "$EXPECTED_SDK" <<'PY'
import json,sys,xml.etree.ElementTree as ET
path,expected=sys.argv[1:]
try:
    root=ET.parse(path).getroot(); payload=None
    for node in root.iter('node'):
        text=node.attrib.get('text','')
        if text.startswith('{') and 'stripeTerminalReadiness' in text:
            payload=json.loads(text); break
    if not payload: raise SystemExit(2)
    r=payload.get('stripeTerminalReadiness',{}); d=r.get('diagnostics',{})
    summary={
      'appVersion':payload.get('appVersion'),'readerState':r.get('readerState'),'capability':r.get('capability'),
      'stripeSdk':d.get('stripeSdk'),'paymentApi':d.get('paymentApi'),'sdkConnectionStatus':d.get('sdkConnectionStatus'),
      'usbPresent':d.get('usbPresent'),'usbPermission':d.get('usbPermission'),'simulatedReader':d.get('simulatedReader'),
      'errorCode':d.get('errorCode')}
    print(json.dumps(summary,separators=(',',':')))
    ok=(d.get('stripeSdk')==expected and d.get('paymentApi')=='processPaymentIntent'
        and d.get('usbPresent') is True and d.get('usbPermission') is True
        and d.get('simulatedReader') is False and d.get('sdkConnectionStatus')=='CONNECTED'
        and r.get('readerState')=='READY' and r.get('capability')=='TERMINAL_AND_QR'
        and not d.get('errorCode'))
    raise SystemExit(0 if ok else 3)
except Exception as e:
    print('probe-diagnostic-parse-error:'+repr(e))
    raise SystemExit(4)
PY
  then READY=1; break; fi
done

if [[ "$READY" != "1" ]]; then
  echo "ERROR: SDK 5.8 probe did not reach READY within 40 seconds" >&2
  "$ADB" -s "$SERIAL" logcat -d -v time | grep -E 'ChargeursStripe58|StripeTerminal' | tail -n 220 || true
  exit 21
fi

# Put the probe kiosk UI in front for the manual cancel/reconnect acceptance cycle.
"$ADB" -s "$SERIAL" shell monkey -p "$NEW_PKG" -c android.intent.category.LAUNCHER 1 >/dev/null
KEEP_PROBE=1

echo "SDK58_PARALLEL_PROBE_READY_PASS"
echo "Canonical package remains installed and untouched: $OLD_PKG"
echo "Probe package now active for physical Terminal/cancel/reconnect testing: $NEW_PKG"
echo "No battery ejection is required."
echo "When testing is finished, run: bash scripts/dta21269-sdk58-parallel-probe-restore.sh"
