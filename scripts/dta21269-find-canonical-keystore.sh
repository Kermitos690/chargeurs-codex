#!/usr/bin/env bash
set -euo pipefail

EXPECTED_SIGNER="b37d4cda37c8623259dfc7aa408328b8f2d04911082c46073b6e1b429ba805a3"
EXPECTED_ALIAS="androiddebugkey"
EXPECTED_STOREPASS="android"
ROOT="$(git rev-parse --show-toplevel)"

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

TMP="$(mktemp -d /tmp/chargeurs-keystore-scan.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
CANDIDATES="$TMP/candidates.txt"
: > "$CANDIDATES"

# Spotlight is fast and read-only on macOS. It may return nothing if indexing is disabled.
if command -v mdfind >/dev/null 2>&1; then
  mdfind '((kMDItemFSName == "*.keystore"cd) || (kMDItemFSName == "*.jks"cd))' 2>/dev/null \
    | awk -v home="$HOME/" 'index($0, home)==1' >> "$CANDIDATES" || true
fi

# Target the places where previous Chargeurs builds/clones and Android signing files are most likely to live.
for base in \
  "$HOME/.android" \
  "$HOME/Downloads" \
  "$HOME/Desktop" \
  "$HOME/Documents" \
  "$HOME/chargeurs-sdk57-test" \
  "$HOME/chargeurs-simulator-1.0.25-preview"
do
  [[ -d "$base" ]] || continue
  find "$base" -maxdepth 7 -type f \
    \( -name 'debug.keystore' -o -name '*.keystore' -o -name '*.jks' \) \
    -print 2>/dev/null >> "$CANDIDATES" || true
done

# Also inspect other top-level Chargeurs-related folders without traversing the whole home directory.
while IFS= read -r dir; do
  [[ -d "$dir" ]] || continue
  find "$dir" -maxdepth 6 -type f \
    \( -name 'debug.keystore' -o -name '*.keystore' -o -name '*.jks' \) \
    -print 2>/dev/null >> "$CANDIDATES" || true
done < <(find "$HOME" -maxdepth 1 -type d \( -iname '*chargeur*' -o -iname '*kiosk*' \) -print 2>/dev/null)

sort -u "$CANDIDATES" -o "$CANDIDATES"
TOTAL="$(wc -l < "$CANDIDATES" | tr -d ' ')"
echo "Checking $TOTAL local keystore candidate(s) without modifying them..."

MATCH=""
CHECKED=0
while IFS= read -r file; do
  [[ -f "$file" ]] || continue
  CHECKED=$((CHECKED + 1))
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
