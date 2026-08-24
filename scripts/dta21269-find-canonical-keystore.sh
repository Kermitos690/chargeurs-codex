#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SIGNER="b37d4cda37c8623259dfc7aa408328b8f2d04911082c46073b6e1b429ba805a3"
EXPECTED_ALIAS="androiddebugkey"
EXPECTED_STOREPASS="android"
ROOT="$(git rev-parse --show-toplevel)"

echo "Keystore scan started (bounded local search; Spotlight disabled)."

find_keytool() {
  local kt
  kt="$(command -v keytool || true)"
  if [[ -x "$kt" ]]; then
    printf '%s' "$kt"
    return 0
  fi
  kt="$(find "$HOME/Library/Caches/chargeurs-jdk" -type f -path '*/Contents/Home/bin/keytool' -perm -u+x -print -quit 2>/dev/null || true)"
  if [[ -x "$kt" ]]; then
    printf '%s' "$kt"
    return 0
  fi
  return 1
}

KEYTOOL="$(find_keytool || true)"
if [[ -z "$KEYTOOL" ]]; then
  echo "ERROR: keytool not found. Run the SDK 5.8 field-test once first so the local JDK is available." >&2
  exit 2
fi

echo "keytool ready."

TMP="$(mktemp -d /tmp/chargeurs-keystore-scan.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
CANDIDATES="$TMP/candidates.txt"
: > "$CANDIDATES"

add_if_file() {
  local file="$1"
  [[ -f "$file" ]] && printf '%s\n' "$file" >> "$CANDIDATES"
}

scan_dir() {
  local label="$1" base="$2" depth="$3"
  [[ -d "$base" ]] || return 0
  echo "Scanning: $label"
  find "$base" -maxdepth "$depth" \
    \( -type d \( -name .git -o -name node_modules -o -name .gradle -o -name build \) -prune \) -o \
    \( -type f \( -name 'debug.keystore' -o -name '*.keystore' -o -name '*.jks' \) -print \) \
    2>/dev/null >> "$CANDIDATES" || true
}

# Highest-probability exact locations first.
echo "Checking exact Android signing locations..."
add_if_file "$HOME/.android/debug.keystore"
add_if_file "$ROOT/android-kiosk/debug.keystore"
add_if_file "$ROOT/debug.keystore"

# Current and known historical Chargeurs clones. These are local-only and bounded.
scan_dir "current Chargeurs clone" "$ROOT" 6
scan_dir "historical simulator clone" "$HOME/chargeurs-simulator-1.0.25-preview" 6

# Other top-level Chargeurs/kiosk folders, without traversing the entire home directory.
echo "Discovering other top-level Chargeurs folders..."
while IFS= read -r dir; do
  [[ "$dir" == "$ROOT" || "$dir" == "$HOME/chargeurs-simulator-1.0.25-preview" ]] && continue
  scan_dir "$(basename "$dir")" "$dir" 5
done < <(find "$HOME" -maxdepth 1 -type d \( -iname '*chargeur*' -o -iname '*kiosk*' \) -print 2>/dev/null)

# User download/desktop folders are searched shallowly only; no Spotlight/iCloud-wide scan.
scan_dir "Downloads (shallow)" "$HOME/Downloads" 3
scan_dir "Desktop (shallow)" "$HOME/Desktop" 3

sort -u "$CANDIDATES" -o "$CANDIDATES"
TOTAL="$(wc -l < "$CANDIDATES" | tr -d ' ')"
echo "Found $TOTAL candidate file(s). Verifying certificate fingerprints..."

MATCH=""
CHECKED=0
while IFS= read -r file; do
  [[ -f "$file" ]] || continue
  CHECKED=$((CHECKED + 1))
  echo "Verifying candidate $CHECKED/$TOTAL: $file"
  OUT="$TMP/keytool-$CHECKED.txt"
  if "$KEYTOOL" -list -v \
      -keystore "$file" \
      -storepass "$EXPECTED_STOREPASS" \
      -alias "$EXPECTED_ALIAS" > "$OUT" 2>/dev/null; then
    DIGEST="$(sed -n 's/^[[:space:]]*SHA256: //p' "$OUT" | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]')"
    if [[ "$DIGEST" == "$EXPECTED_SIGNER" ]]; then
      MATCH="$file"
      break
    fi
  fi
done < "$CANDIDATES"

if [[ -z "$MATCH" ]]; then
  echo "CANONICAL_KEYSTORE_NOT_FOUND"
  echo "Checked: $CHECKED candidate(s)"
  echo "The Stripe Terminal 5.8 build itself is already green; only signer continuity remains blocked."
  exit 31
fi

echo "CANONICAL_KEYSTORE_FOUND=$MATCH"
echo "Signer: $EXPECTED_SIGNER"
echo "Re-running the fail-closed Stripe Terminal 5.8 field gate with the canonical signer..."

export CHARGEURS_STAGING_KEYSTORE_PATH="$MATCH"
export CHARGEURS_STAGING_KEYSTORE_PASSWORD="$EXPECTED_STOREPASS"
export CHARGEURS_STAGING_KEY_ALIAS="$EXPECTED_ALIAS"
export CHARGEURS_STAGING_KEY_PASSWORD="$EXPECTED_STOREPASS"

exec bash "$ROOT/scripts/dta21269-sdk58-field-test.sh"
