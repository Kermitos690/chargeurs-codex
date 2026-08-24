#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BASE="$ROOT/scripts/dta21269-sdk57-field-test.sh"
[[ -f "$BASE" ]] || { echo "ERROR: base field-test script missing" >&2; exit 2; }

# BSD mktemp on macOS requires the XXXXXX template to be the final characters.
TMP_SCRIPT="$(mktemp /tmp/dta21269-sdk57-field-test-v2.XXXXXX)"
trap 'rm -f "$TMP_SCRIPT"' EXIT

python3 - "$BASE" "$TMP_SCRIPT" <<'PY'
from pathlib import Path
import sys
src = Path(sys.argv[1]).read_text()
old = './gradlew --no-daemon clean :app:testStagingUnitTest :app:lintStaging :app:assembleStaging'
new = r'''TASK_LIST="$(./gradlew --no-daemon -q :app:tasks --all)"
if grep -Eq '^[[:space:]]*testStagingUnitTest([[:space:]-]|$)' <<<"$TASK_LIST"; then
  UNIT_TEST_TASK=":app:testStagingUnitTest"
elif grep -Eq '^[[:space:]]*testDebugUnitTest([[:space:]-]|$)' <<<"$TASK_LIST"; then
  UNIT_TEST_TASK=":app:testDebugUnitTest"
elif grep -Eq '^[[:space:]]*test([[:space:]-]|$)' <<<"$TASK_LIST"; then
  UNIT_TEST_TASK=":app:test"
else
  echo "ERROR: no unit-test task is available in :app" >&2
  echo "AVAILABLE_TEST_TASKS:" >&2
  grep -Ei '^[[:space:]]*test[^ ]*' <<<"$TASK_LIST" >&2 || true
  exit 23
fi

if grep -Eq '^[[:space:]]*lintStaging([[:space:]-]|$)' <<<"$TASK_LIST"; then
  LINT_TASK=":app:lintStaging"
elif grep -Eq '^[[:space:]]*lintDebug([[:space:]-]|$)' <<<"$TASK_LIST"; then
  LINT_TASK=":app:lintDebug"
else
  echo "ERROR: no lint task suitable for the staging/debug Android code is available" >&2
  exit 24
fi

if ! grep -Eq '^[[:space:]]*assembleStaging([[:space:]-]|$)' <<<"$TASK_LIST"; then
  echo "ERROR: assembleStaging is not available; refusing to build a different APK variant" >&2
  exit 25
fi

echo "Gradle gates: $UNIT_TEST_TASK $LINT_TASK :app:assembleStaging"
./gradlew --no-daemon clean "$UNIT_TEST_TASK" "$LINT_TASK" :app:assembleStaging'''
if old not in src:
    raise SystemExit('ERROR: expected Gradle gate command not found in base script')
Path(sys.argv[2]).write_text(src.replace(old, new, 1))
PY

chmod +x "$TMP_SCRIPT"
exec bash "$TMP_SCRIPT"
