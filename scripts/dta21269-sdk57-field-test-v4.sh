#!/usr/bin/env bash
set -euo pipefail

EXPECTED_BRANCH="fix/dta21269-terminal-sdk-5-7"
ROOT="$(git rev-parse --show-toplevel)"
V3="$ROOT/scripts/dta21269-sdk57-field-test-v3.sh"
SOURCE_REL="android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java"
SOURCE="$ROOT/$SOURCE_REL"

[[ -f "$V3" ]] || { echo "ERROR: v3 field-test script missing" >&2; exit 2; }
[[ -f "$SOURCE" ]] || { echo "ERROR: StripeTerminalReaderRuntime.java missing" >&2; exit 2; }

CURRENT_BRANCH="$(git -C "$ROOT" branch --show-current)"
[[ "$CURRENT_BRANCH" == "$EXPECTED_BRANCH" ]] || {
  echo "ERROR: expected branch $EXPECTED_BRANCH, got $CURRENT_BRANCH" >&2
  exit 2
}

# Refuse to hide unrelated tracked edits in this fresh field-test clone.
OTHER_DIRTY="$(git -C "$ROOT" diff --name-only | grep -v "^${SOURCE_REL}$" || true)"
if [[ -n "$OTHER_DIRTY" ]]; then
  echo "ERROR: unrelated tracked edits are present; refusing to modify the runtime:" >&2
  echo "$OTHER_DIRTY" >&2
  exit 27
fi

# Stripe Terminal Android 5.x renamed CollectConfiguration to
# CollectPaymentIntentConfiguration. Stripe 5.7 keeps Builder.skipTipping(Boolean),
# so this is a type/API-name migration only; payment behaviour is unchanged.
python3 - "$SOURCE" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")
old = "CollectConfiguration"
new = "CollectPaymentIntentConfiguration"

if old in s:
    before = s.count(old)
    s = s.replace(old, new)
    p.write_text(s, encoding="utf-8")
    print(f"Stripe 5.7 collect config migration applied: {before} replacement(s)")
elif new in s:
    print("Stripe 5.7 collect config migration already applied")
else:
    raise SystemExit("ERROR: neither old nor new Stripe collect configuration type is present")
PY

git -C "$ROOT" diff --check -- "$SOURCE_REL"

LOG="$(mktemp /tmp/dta21269-sdk57-v4.XXXXXX)"
trap 'rm -f "$LOG"' EXIT

set +e
bash "$V3" 2>&1 | tee "$LOG"
RC=${PIPESTATUS[0]}
set -e

# Persist the source migration only after the static build/signing gate proved
# the SDK 5.7 APK is valid. ADB may still be unavailable afterwards; that must
# not force a known-good compile fix to remain only in the local clone.
if grep -q '^SDK57_PREINSTALL_PASS$' "$LOG"; then
  if ! git -C "$ROOT" diff --quiet -- "$SOURCE_REL"; then
    git -C "$ROOT" add "$SOURCE_REL"
    if git -C "$ROOT" commit -m "fix(android): use Stripe 5.7 collect payment configuration"; then
      if git -C "$ROOT" push origin HEAD:"$EXPECTED_BRANCH"; then
        echo "SDK57_SOURCE_FIX_PUSHED"
      else
        echo "WARNING: build passed but automatic git push failed; source commit remains local" >&2
      fi
    else
      echo "WARNING: build passed but automatic git commit failed; source change remains local" >&2
    fi
  else
    echo "SDK57_SOURCE_FIX_ALREADY_PERSISTED"
  fi
fi

exit "$RC"
