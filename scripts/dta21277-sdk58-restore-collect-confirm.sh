#!/usr/bin/env bash
set -Eeuo pipefail

TARGET_BRANCH="fix/dta21269-terminal-sdk-5-7"
TARGET_STATION="DTA21277"
TARGET_MDNS="adb-3d24b8cbb7d560bc-r6qk3T._adb-tls-connect._tcp"
PKG="ch.chargeurs.kiosk.staging"
EXPECTED_OLD_VERSION="158"
EXPECTED_NEW_VERSION="159"
EXPECTED_NEW_NAME="1.0.59-terminal-sdk580-collect-confirm-staging"
EXPECTED_DEVICE_PUBLIC_ID="c1651928-082d-4220-a4dc-77e9532ae8a2"
EXPECTED_LOCATION="tml_GnoORA0w9yjeut"
EXPECTED_SDK="5.8.0-test-only"
EXPECTED_PAYMENT_API="collectPaymentMethod+confirmPaymentIntent"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

JAVA_HOME="${JAVA_HOME:-$HOME/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/jdk-21.0.12.1+1/Contents/Home}"
ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME ANDROID_HOME
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/build-tools/36.0.0:$PATH"

ADB="$ANDROID_HOME/platform-tools/adb"
APKSIGNER="$ANDROID_HOME/build-tools/36.0.0/apksigner"
RUNTIME="android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java"
GRADLE="android-kiosk/app/build.gradle.kts"
APK="android-kiosk/app/build/outputs/apk/staging/app-staging.apk"

[[ -x "$JAVA_HOME/bin/java" ]] || { echo "FIELD_FIX_RESULT=FAIL java_missing"; exit 2; }
[[ -x "$ADB" ]] || { echo "FIELD_FIX_RESULT=FAIL adb_missing"; exit 2; }
[[ -x "$APKSIGNER" ]] || { echo "FIELD_FIX_RESULT=FAIL apksigner_missing"; exit 2; }
[[ -f "$RUNTIME" && -f "$GRADLE" ]] || { echo "FIELD_FIX_RESULT=FAIL source_missing"; exit 2; }

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "FIELD_FIX_RESULT=FAIL tracked_worktree_not_clean"
  git status --short
  exit 3
fi

echo "REFERENCE_STATION=$TARGET_STATION"
echo "ACTION=RESTORE_SDK58_COLLECT_CONFIRM_AND_INSTALL"
echo "PAYMENT_ACTION=NONE"
echo "HARDWARE_EJECTION_ACTION=NONE"
echo "STRIPE_SDK=$EXPECTED_SDK"

python3 - "$RUNTIME" "$GRADLE" <<'PY'
from pathlib import Path
import sys
runtime = Path(sys.argv[1])
gradle = Path(sys.argv[2])
s = runtime.read_text()
g = gradle.read_text()

if 'collectPaymentMethod+confirmPaymentIntent' not in s:
    replacements = [
        (
            " * and kiosk layers. The runtime uses Stripe's v5 unified processPaymentIntent()\n * flow so card collection + confirmation have one cancelable operation.\n",
            " * and kiosk layers. On the physical WisePad USB lane we deliberately use\n * Stripe's supported two-step collectPaymentMethod() + confirmPaymentIntent()\n * flow because it is the field-proven path that actually drives this reader.\n",
        ),
        ('"paymentApi", "processPaymentIntent",', '"paymentApi", "collectPaymentMethod+confirmPaymentIntent",'),
        ('main.post(() -> retrieveAndProcess(result.clientSecret(), operationGeneration));',
         'main.post(() -> retrieveAndCollectAndConfirm(result.clientSecret(), operationGeneration));'),
    ]
    for old, new in replacements:
        if old not in s:
            raise SystemExit(f"expected runtime marker missing: {old[:80]!r}")
        s = s.replace(old, new, 1)

    old_method = '''    private void retrieveAndProcess(String clientSecret, int operationGeneration) {
        if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
        if (!Terminal.isInitialized() || Terminal.getInstance().getConnectedReader() == null) {
            finishPaymentFailure("TERMINAL_DISCONNECTED");
            return;
        }

        Terminal.getInstance().retrievePaymentIntent(clientSecret, new PaymentIntentCallback() {
            @Override
            public void onSuccess(PaymentIntent paymentIntent) {
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                localPaymentState = "PROCESSING";
                paymentRailState = "PROCESSING";
                CollectPaymentIntentConfiguration collect = new CollectPaymentIntentConfiguration.Builder()
                    .skipTipping(true)
                    .build();
                ConfirmPaymentIntentConfiguration confirm = new ConfirmPaymentIntentConfiguration.Builder().build();
                paymentCancelable = Terminal.getInstance().processPaymentIntent(
                    paymentIntent,
                    collect,
                    confirm,
                    new PaymentIntentCallback() {
                        @Override
                        public void onSuccess(PaymentIntent processed) {
                            if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                            paymentCancelable = null;
                            activePaymentIntentId = processed.getId();
                            localPaymentState = "SDK_SUCCEEDED";
                            paymentRailState = "PROCESSING";
                            paymentRunning.set(false);
                            readerState = idleReaderState();
                            refreshPaymentState(true);
                        }

                        @Override
                        public void onFailure(TerminalException error) {
                            if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                            paymentCancelable = null;
                            if (isCancellation(error)) {
                                cancelAfterReaderStop();
                                return;
                            }
                            finishPaymentFailure(safeTerminalCode(error));
                            refreshPaymentState(true);
                        }
                    }
                );
            }

            @Override
            public void onFailure(TerminalException error) {
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                finishPaymentFailure(safeTerminalCode(error));
                refreshPaymentState(true);
            }
        });
    }
'''
    new_method = '''    private void retrieveAndCollectAndConfirm(String clientSecret, int operationGeneration) {
        if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
        if (!Terminal.isInitialized() || Terminal.getInstance().getConnectedReader() == null) {
            finishPaymentFailure("TERMINAL_DISCONNECTED");
            return;
        }

        Terminal.getInstance().retrievePaymentIntent(clientSecret, new PaymentIntentCallback() {
            @Override
            public void onSuccess(PaymentIntent paymentIntent) {
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                localPaymentState = "COLLECTING";
                paymentRailState = "PROCESSING";
                CollectPaymentIntentConfiguration collect = new CollectPaymentIntentConfiguration.Builder()
                    .skipTipping(true)
                    .build();
                paymentCancelable = Terminal.getInstance().collectPaymentMethod(
                    paymentIntent,
                    new PaymentIntentCallback() {
                        @Override
                        public void onSuccess(PaymentIntent collected) {
                            if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                            paymentCancelable = null;
                            localPaymentState = "CONFIRMING";
                            ConfirmPaymentIntentConfiguration confirm = new ConfirmPaymentIntentConfiguration.Builder().build();
                            paymentCancelable = Terminal.getInstance().confirmPaymentIntent(
                                collected,
                                new PaymentIntentCallback() {
                                    @Override
                                    public void onSuccess(PaymentIntent processed) {
                                        if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                                        paymentCancelable = null;
                                        activePaymentIntentId = processed.getId();
                                        localPaymentState = "SDK_SUCCEEDED";
                                        paymentRailState = "PROCESSING";
                                        paymentRunning.set(false);
                                        readerState = idleReaderState();
                                        refreshPaymentState(true);
                                    }

                                    @Override
                                    public void onFailure(TerminalException error) {
                                        if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                                        paymentCancelable = null;
                                        if (isCancellation(error)) {
                                            cancelAfterReaderStop();
                                            return;
                                        }
                                        finishPaymentFailure(safeTerminalCode(error));
                                        refreshPaymentState(true);
                                    }
                                },
                                confirm
                            );
                        }

                        @Override
                        public void onFailure(TerminalException error) {
                            if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                            paymentCancelable = null;
                            if (isCancellation(error)) {
                                cancelAfterReaderStop();
                                return;
                            }
                            finishPaymentFailure(safeTerminalCode(error));
                            refreshPaymentState(true);
                        }
                    },
                    collect
                );
            }

            @Override
            public void onFailure(TerminalException error) {
                if (!isCurrentPaymentOperation(operationGeneration, paymentOperationGeneration.get())) return;
                finishPaymentFailure(safeTerminalCode(error));
                refreshPaymentState(true);
            }
        });
    }
'''
    if old_method not in s:
        raise SystemExit('expected processPaymentIntent method block missing')
    s = s.replace(old_method, new_method, 1)
    runtime.write_text(s)

if '1.0.59-terminal-sdk580-collect-confirm' not in g:
    if 'versionCode = if (stagingSimulatedTerminalReaderVersion) 157 else 158' not in g:
        raise SystemExit('expected versionCode 158 marker missing')
    if '"1.0.58-terminal-sdk580-process-reconnect"' not in g:
        raise SystemExit('expected versionName 1.0.58 marker missing')
    g = g.replace('versionCode = if (stagingSimulatedTerminalReaderVersion) 157 else 158',
                  'versionCode = if (stagingSimulatedTerminalReaderVersion) 157 else 159', 1)
    g = g.replace('"1.0.58-terminal-sdk580-process-reconnect"',
                  '"1.0.59-terminal-sdk580-collect-confirm"', 1)
    gradle.write_text(g)
PY

git diff --check

echo "SOURCE_PATCH=PASS"

echo "BUILD_PHASE=START"
(
  cd android-kiosk
  ./gradlew :app:testDebugUnitTest :app:lintStaging :app:assembleStaging --no-daemon
)
[[ -f "$APK" ]] || { echo "FIELD_FIX_RESULT=FAIL apk_missing_after_build"; exit 10; }
echo "BUILD_PHASE=PASS"

while IFS= read -r endpoint; do
  [[ -n "$endpoint" ]] || continue
  "$ADB" connect "$endpoint" >/dev/null 2>&1 || true
done < <("$ADB" mdns services 2>/dev/null | grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]+' | sort -u || true)

SERIAL="$TARGET_MDNS"
if ! "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1; then
  SERIAL="$("$ADB" mdns services 2>/dev/null | awk '$1 ~ /^adb-3d24b8cbb7d560bc-r6qk3T/ {print $3; exit}')"
fi
[[ -n "$SERIAL" ]] && "$ADB" -s "$SERIAL" get-state >/dev/null 2>&1 || { echo "FIELD_FIX_RESULT=FAIL dta21277_adb_unavailable"; exit 11; }
echo "REFERENCE_ADB_SERIAL=$SERIAL"

read_pref() {
  local file="$1" key="$2"
  "$ADB" -s "$SERIAL" shell "run-as '$PKG' cat 'shared_prefs/$file.xml' 2>/dev/null" \
    | tr -d '\r' \
    | sed -n "s/.*<string name=\"$key\">\([^<]*\)<\\/string>.*/\1/p" \
    | head -1
}

STATION="$(read_pref chargeurs_kiosk_config station_id || true)"
DEVICE="$(read_pref chargeurs_device_identity public_id || true)"
[[ "$STATION" == "$TARGET_STATION" ]] || { echo "FIELD_FIX_RESULT=FAIL wrong_station station=$STATION"; exit 12; }
[[ "$DEVICE" == "$EXPECTED_DEVICE_PUBLIC_ID" ]] || { echo "FIELD_FIX_RESULT=FAIL wrong_device_identity device=$DEVICE"; exit 13; }

echo "DEVICE_IDENTITY=PASS"

USB="$($ADB -s "$SERIAL" shell '
for d in /sys/bus/usb/devices/*; do
  [ -f "$d/idVendor" ] || continue
  [ -f "$d/idProduct" ] || continue
  v=$(cat "$d/idVendor" 2>/dev/null | tr "A-Z" "a-z")
  p=$(cat "$d/idProduct" 2>/dev/null | tr "A-Z" "a-z")
  if [ "$v" = "15a2" ] && [ "$p" = "0101" ]; then echo PRESENT; exit 0; fi
done
echo ABSENT
' | tr -d '\r\n')"
[[ "$USB" == "PRESENT" ]] || { echo "FIELD_FIX_RESULT=FAIL wisepad_usb_absent"; exit 14; }
echo "WISEPAD_USB=PRESENT"

DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
OLD_CODE="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
[[ "$OLD_CODE" == "$EXPECTED_OLD_VERSION" || "$OLD_CODE" == "$EXPECTED_NEW_VERSION" ]] || {
  echo "FIELD_FIX_RESULT=FAIL unexpected_installed_version versionCode=$OLD_CODE"
  exit 15
}

TMP="$(mktemp -d /tmp/dta21277-collect-confirm.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
INSTALLED_PATH="$("$ADB" -s "$SERIAL" shell pm path "$PKG" | tr -d '\r' | sed -n 's/^package://p' | head -1)"
[[ -n "$INSTALLED_PATH" ]] || { echo "FIELD_FIX_RESULT=FAIL installed_apk_path_missing"; exit 16; }
"$ADB" -s "$SERIAL" pull "$INSTALLED_PATH" "$TMP/installed.apk" >/dev/null
INSTALLED_SIGNER="$($APKSIGNER verify --print-certs "$TMP/installed.apk" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr 'A-F' 'a-f')"
NEW_SIGNER="$($APKSIGNER verify --print-certs "$APK" 2>/dev/null | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1 | tr 'A-F' 'a-f')"
[[ -n "$INSTALLED_SIGNER" && "$INSTALLED_SIGNER" == "$NEW_SIGNER" ]] || {
  echo "FIELD_FIX_RESULT=FAIL signer_mismatch installed=$INSTALLED_SIGNER new=$NEW_SIGNER"
  exit 17
}
echo "SIGNER_CONTINUITY=PASS"

if [[ "$OLD_CODE" != "$EXPECTED_NEW_VERSION" ]]; then
  "$ADB" -s "$SERIAL" install -r "$APK" >/tmp/dta21277-install.out 2>&1 || {
    cat /tmp/dta21277-install.out
    echo "FIELD_FIX_RESULT=FAIL adb_install_failed"
    exit 18
  }
  cat /tmp/dta21277-install.out
  echo "APK_UPDATE=PASS"
else
  echo "APK_UPDATE=ALREADY_INSTALLED"
fi

DUMP="$("$ADB" -s "$SERIAL" shell dumpsys package "$PKG" | tr -d '\r')"
NEW_CODE="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionCode=\([0-9][0-9]*\).*/\1/p' | head -1)"
NEW_NAME="$(printf '%s\n' "$DUMP" | sed -n 's/.*versionName=\(.*\)$/\1/p' | head -1)"
[[ "$NEW_CODE" == "$EXPECTED_NEW_VERSION" && "$NEW_NAME" == "$EXPECTED_NEW_NAME" ]] || {
  echo "FIELD_FIX_RESULT=FAIL wrong_new_apk versionCode=$NEW_CODE versionName=$NEW_NAME"
  exit 19
}

"$ADB" -s "$SERIAL" shell am force-stop "$PKG" >/dev/null 2>&1 || true
sleep 1
"$ADB" -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 3

READY=0
LAST=""
for attempt in $(seq 1 45); do
  "$ADB" -s "$SERIAL" shell am start -n "$PKG/ch.chargeurs.kiosk.HardwareDiagnosticActivity" >/dev/null 2>&1 || true
  sleep 2
  "$ADB" -s "$SERIAL" shell uiautomator dump /sdcard/chargeurs-dta21277-collect-confirm.xml >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell cat /sdcard/chargeurs-dta21277-collect-confirm.xml > "$TMP/window.xml" 2>/dev/null || true
  SUMMARY="$(python3 - "$TMP/window.xml" <<'PY' 2>/dev/null || true
import json,sys,xml.etree.ElementTree as ET
try: root=ET.parse(sys.argv[1]).getroot()
except Exception: raise SystemExit
for node in root.iter('node'):
    text=node.attrib.get('text','')
    if not (text.startswith('{') and 'stripeTerminalReadiness' in text): continue
    try: payload=json.loads(text)
    except Exception: continue
    r=payload.get('stripeTerminalReadiness') or {}; d=r.get('diagnostics') or {}
    print(json.dumps({
      'readerState':r.get('readerState'),'capability':r.get('capability'),
      'stripeSdk':d.get('stripeSdk'),'sdkConnectionStatus':d.get('sdkConnectionStatus'),
      'usbPresent':d.get('usbPresent'),'usbPermission':d.get('usbPermission'),
      'locationPermission':d.get('locationPermission'),'paymentApi':d.get('paymentApi'),
      'stripeReaderSerial':d.get('stripeReaderSerial'),'stripeLocationId':d.get('stripeLocationId'),
      'expectedReaderId':d.get('expectedReaderId'),'errorCode':d.get('errorCode')
    },separators=(',',':')))
    break
PY
)"
  [[ -n "$SUMMARY" ]] || continue
  if [[ "$SUMMARY" != "$LAST" ]]; then echo "READINESS=$SUMMARY"; LAST="$SUMMARY"; fi
  if python3 - "$SUMMARY" "$EXPECTED_SDK" "$EXPECTED_PAYMENT_API" "$EXPECTED_LOCATION" <<'PY' >/dev/null 2>&1
import json,sys
s=json.loads(sys.argv[1])
ok=(s.get('readerState')=='READY' and s.get('capability')=='TERMINAL_AND_QR' and
    s.get('stripeSdk')==sys.argv[2] and s.get('paymentApi')==sys.argv[3] and
    s.get('sdkConnectionStatus')=='CONNECTED' and s.get('usbPresent') is True and
    s.get('usbPermission') is True and s.get('locationPermission') is True and
    s.get('stripeLocationId')==sys.argv[4] and s.get('expectedReaderId') in (None,''))
raise SystemExit(0 if ok else 1)
PY
  then READY=1; break; fi
done

[[ "$READY" == "1" ]] || {
  echo "LAST_READINESS=${LAST:-none}"
  "$ADB" -s "$SERIAL" logcat -d -t 500 | grep -E 'ChargeursStripe58|StripeTerminal' | tail -120 || true
  echo "FIELD_FIX_RESULT=FAIL reader_not_ready_after_update"
  exit 20
}

echo "STRIPE58_READY=PASS"

# Record only the two source changes after compile + install + READY have passed.
if ! git diff --quiet -- "$RUNTIME" "$GRADLE"; then
  git add "$RUNTIME" "$GRADLE"
  git commit -m "fix(android): restore WisePad collect-confirm flow on SDK 5.8"
  git push origin "HEAD:$TARGET_BRANCH"
  echo "SOURCE_PUSH=PASS"
else
  echo "SOURCE_PUSH=ALREADY_COMMITTED"
fi

echo "FIELD_FIX_RESULT=PASS"
echo "NEXT_FIELD_ACTION=Tap Sans contact once; no card is needed. WisePad should leave the Stripe splash and show the card-present prompt."
