#!/usr/bin/env bash
set -u

EXPECTED="b37d4cda37c8623259dfc7aa408328b8f2d04911082c46073b6e1b429ba805a3"
JDK_DEFAULT="$HOME/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/jdk-21.0.12.1+1/Contents/Home"
JAVA_HOME="${JAVA_HOME:-$JDK_DEFAULT}"
KEYTOOL="$JAVA_HOME/bin/keytool"

if [[ ! -x "$KEYTOOL" ]]; then
  echo "KEYSTORE_SEARCH_RESULT=ERROR"
  echo "ERROR: keytool not found at $KEYTOOL" >&2
  exit 1
fi

echo "ACTION=FIND_CANONICAL_STAGING_KEYSTORE_READ_ONLY"
echo "EXPECTED_SIGNER_SHA256=$EXPECTED"
echo "No files will be changed, moved, copied, deleted, or uploaded."
echo "Search is limited to likely Android/Chargeurs keystore locations on this Mac."

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TMP="$(mktemp -d /tmp/chargeurs-b37-keystore-search.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# Deliberately constrained search roots. Do not crawl the whole home directory.
ROOTS=(
  "$HOME/.android"
  "$ROOT"
  "$HOME/Library/Caches/chargeurs-jdk"
  "$HOME/Downloads"
  "$HOME/Desktop"
)

CANDIDATES="$TMP/candidates.txt"
: > "$CANDIDATES"
for r in "${ROOTS[@]}"; do
  [[ -d "$r" ]] || continue
  find "$r" -maxdepth 6 -type f \(
    -name 'debug.keystore' -o \
    -name '*.keystore' -o \
    -name '*.jks' -o \
    -name '*.p12' -o \
    -name '*.pfx' \
  \) -print 2>/dev/null >> "$CANDIDATES"
done
sort -u "$CANDIDATES" -o "$CANDIDATES"

COUNT="$(wc -l < "$CANDIDATES" | tr -d ' ')"
echo "KEYSTORE_CANDIDATES=$COUNT"

fingerprint_with_password() {
  local file="$1" pass="$2"
  "$KEYTOOL" -list -v -keystore "$file" -storepass "$pass" 2>/dev/null \
    | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' \
    | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]'
}

FOUND=""
while IFS= read -r file; do
  [[ -n "$file" ]] || continue
  size="$(wc -c < "$file" 2>/dev/null | tr -d ' ' || true)"
  echo "CANDIDATE=$file bytes=${size:-unknown}"

  fp="$(fingerprint_with_password "$file" android || true)"
  if [[ -n "$fp" ]]; then
    echo "  STOREPASS_android_SHA256=$fp"
    if [[ "$fp" == "$EXPECTED" ]]; then
      FOUND="$file"
      echo "CANONICAL_B37_KEYSTORE_FOUND=$file"
      echo "CANONICAL_B37_STOREPASS=android"
      break
    fi
  else
    echo "  STOREPASS_android_SHA256=UNREADABLE_OR_DIFFERENT_PASSWORD"
  fi

done < "$CANDIDATES"

if [[ -n "$FOUND" ]]; then
  echo "KEYSTORE_SEARCH_RESULT=CANONICAL_B37_FOUND"
  exit 0
fi

echo "KEYSTORE_SEARCH_RESULT=CANONICAL_B37_NOT_FOUND_IN_LIKELY_LOCATIONS"
exit 2
