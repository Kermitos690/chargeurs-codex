#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

find_java_home() {
  if [[ -n "${JAVA_HOME:-}" && -x "$JAVA_HOME/bin/java" ]]; then
    printf '%s' "$JAVA_HOME"
    return 0
  fi

  local known="$HOME/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/jdk-21.0.12.1+1/Contents/Home"
  if [[ -x "$known/bin/java" ]]; then
    printf '%s' "$known"
    return 0
  fi

  local candidate
  for candidate in "$HOME"/Library/Caches/chargeurs-jdk/temurin21-x64/unpack/*/Contents/Home; do
    if [[ -x "$candidate/bin/java" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  if [[ -x /usr/libexec/java_home ]]; then
    candidate="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"
    if [[ -n "$candidate" && -x "$candidate/bin/java" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  fi

  return 1
}

RESOLVED_JAVA_HOME="$(find_java_home || true)"
if [[ -z "$RESOLVED_JAVA_HOME" ]]; then
  echo "JAVA_BOOTSTRAP_RESULT=JAVA_NOT_FOUND"
  echo "Expected an existing JDK under ~/Library/Caches/chargeurs-jdk or JAVA_HOME."
  exit 10
fi

export JAVA_HOME="$RESOLVED_JAVA_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

echo "JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -3

echo "JAVA_BOOTSTRAP_RESULT=READY"
exec bash "$ROOT/scripts/dta21277-signer-truth.sh"
