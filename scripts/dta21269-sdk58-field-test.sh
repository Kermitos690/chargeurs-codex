#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BASE="$ROOT/scripts/dta21269-sdk57-field-test.sh"
[[ -f "$BASE" ]] || { echo "ERROR: base field-test script missing" >&2; exit 2; }

resolve_android_sdk() {
  local candidate adb_path adb_real derived
  for candidate in \
    "${ANDROID_HOME:-}" \
    "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" \
    "$HOME/Android/Sdk"
  do
    [[ -n "$candidate" ]] || continue
    if [[ -d "$candidate/build-tools" && -d "$candidate/platforms" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  adb_path="$(command -v adb || true)"
  if [[ -n "$adb_path" ]]; then
    adb_real="$(python3 - "$adb_path" <<'PY'
import os, sys
print(os.path.realpath(sys.argv[1]))
PY
)"
    if [[ "$adb_real" == */platform-tools/adb ]]; then
      derived="${adb_real%/platform-tools/adb}"
      if [[ -d "$derived/build-tools" && -d "$derived/platforms" ]]; then
        printf '%s' "$derived"
        return 0
      fi
    fi
  fi
  return 1
}

SDK="$(resolve_android_sdk || true)"
if [[ -z "$SDK" ]]; then
  echo "ERROR: Android build SDK could not be located." >&2
  exit 26
fi
export ANDROID_HOME="$SDK"
export ANDROID_SDK_ROOT="$SDK"
echo "Android SDK: $ANDROID_HOME"

python3 - "$ROOT/android-kiosk/local.properties" "$ANDROID_HOME" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
sdk = sys.argv[2].replace('\\', '\\\\').replace(':', '\\:')
p.write_text(f"sdk.dir={sdk}\n", encoding='utf-8')
PY

TMP_SCRIPT="$(mktemp /tmp/dta21269-sdk58-field-test.XXXXXX)"
trap 'rm -f "$TMP_SCRIPT"' EXIT

python3 - "$BASE" "$TMP_SCRIPT" "$ROOT" <<'PY'
from pathlib import Path
import sys
src = Path(sys.argv[1]).read_text(encoding='utf-8')
out = Path(sys.argv[2])
root = Path(sys.argv[3])

replacements = {
    'EXPECTED_VERSION_CODE="157"': 'EXPECTED_VERSION_CODE="158"',
    'EXPECTED_VERSION_NAME="1.0.57-terminal-sdk570-reconnect-staging"': 'EXPECTED_VERSION_NAME="1.0.58-terminal-sdk580-process-reconnect-staging"',
    'EXPECTED_SDK="5.7.0-test-only"': 'EXPECTED_SDK="5.8.0-test-only"',
    'com.stripe:stripeterminal:5.7.0': 'com.stripe:stripeterminal:5.8.0',
    'Stripe Terminal 5.7.0': 'Stripe Terminal 5.8.0',
    'ChargeursStripe57': 'ChargeursStripe58',
    'SDK57_PREINSTALL_PASS': 'SDK58_PREINSTALL_PASS',
    'SDK57_FIELD_READY_PASS': 'SDK58_FIELD_READY_PASS',
    'dta21269-sdk57-field-test.sh': 'dta21269-sdk58-field-test.sh',
    '/tmp/dta21269-sdk57.XXXXXX': '/tmp/dta21269-sdk58.XXXXXX',
}
for old, new in replacements.items():
    if old not in src:
        raise SystemExit(f'ERROR: expected base marker not found: {old}')
    src = src.replace(old, new)

old_gradle = './gradlew --no-daemon clean :app:testStagingUnitTest :app:lintStaging :app:assembleStaging'
new_gradle = r'''RUNTIME="$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java"
BRIDGE="$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/NativeBridge.java"
grep -q 'processPaymentIntent' "$RUNTIME" || { echo "ERROR: unified processPaymentIntent flow missing" >&2; exit 27; }
! grep -q 'CollectConfiguration' "$RUNTIME" || { echo "ERROR: legacy CollectConfiguration still present" >&2; exit 28; }
grep -q 'rebootPaymentReader' "$BRIDGE" || { echo "ERROR: guarded reader reboot bridge missing" >&2; exit 29; }
grep -q 'installPaymentReaderUpdate' "$BRIDGE" || { echo "ERROR: reader update bridge missing" >&2; exit 30; }

TASK_LIST="$(./gradlew --no-daemon -q :app:tasks --all)"
if grep -Eq '^[[:space:]]*testStagingUnitTest([[:space:]-]|$)' <<<"$TASK_LIST"; then
  UNIT_TEST_TASK=":app:testStagingUnitTest"
elif grep -Eq '^[[:space:]]*testDebugUnitTest([[:space:]-]|$)' <<<"$TASK_LIST"; then
  UNIT_TEST_TASK=":app:testDebugUnitTest"
elif grep -Eq '^[[:space:]]*test([[:space:]-]|$)' <<<"$TASK_LIST"; then
  UNIT_TEST_TASK=":app:test"
else
  echo "ERROR: no unit-test task is available in :app" >&2
  exit 23
fi

if grep -Eq '^[[:space:]]*lintStaging([[:space:]-]|$)' <<<"$TASK_LIST"; then
  LINT_TASK=":app:lintStaging"
elif grep -Eq '^[[:space:]]*lintDebug([[:space:]-]|$)' <<<"$TASK_LIST"; then
  LINT_TASK=":app:lintDebug"
else
  echo "ERROR: no lint task suitable for staging/debug is available" >&2
  exit 24
fi

if ! grep -Eq '^[[:space:]]*assembleStaging([[:space:]-]|$)' <<<"$TASK_LIST"; then
  echo "ERROR: assembleStaging is unavailable; refusing a different APK variant" >&2
  exit 25
fi

echo "Gradle gates: $UNIT_TEST_TASK $LINT_TASK :app:assembleStaging"
./gradlew --no-daemon clean "$UNIT_TEST_TASK" "$LINT_TASK" :app:assembleStaging'''
if old_gradle not in src:
    raise SystemExit('ERROR: expected Gradle gate command not found in base script')
src = src.replace(old_gradle, new_gradle, 1)

# Require the installed diagnostic payload to prove that the unified API is the
# one actually running, not merely present in source.
old_ready = "and d.get('simulatedReader') is False and r.get('readerState') == 'READY'"
new_ready = "and d.get('simulatedReader') is False and d.get('paymentApi') == 'processPaymentIntent' and r.get('readerState') == 'READY'"
if old_ready not in src:
    raise SystemExit('ERROR: readiness predicate marker not found in base script')
src = src.replace(old_ready, new_ready, 1)

out.write_text(src, encoding='utf-8')
PY

chmod +x "$TMP_SCRIPT"
exec bash "$TMP_SCRIPT"
