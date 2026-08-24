#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
BASE="$ROOT/scripts/dta21269-sdk58-parallel-probe.sh"
[[ -f "$BASE" ]] || { echo "ERROR: base sdk58 parallel probe missing" >&2; exit 2; }
TMP="$(mktemp /tmp/dta21269-sdk58-safe-probe.XXXXXX)"
trap 'rm -f "$TMP"' EXIT
python3 - "$BASE" "$TMP" <<'PY'
from pathlib import Path
import sys
src=Path(sys.argv[1]).read_text(encoding='utf-8')
out=Path(sys.argv[2])

old='''# Remove only an earlier probe package. The canonical staging package is never uninstalled.\nif "$ADB" -s "$SERIAL" shell pm path "$NEW_PKG" | grep -q '^package:'; then\n  echo "Removing previous side-by-side probe package only..."\n  "$ADB" -s "$SERIAL" uninstall "$NEW_PKG" >/dev/null\nfi\n\necho "Installing side-by-side SDK 5.8 probe (canonical app remains installed)..."\n"$ADB" -s "$SERIAL" install "$APK" >/dev/null'''
new='''# Install/update only the side-by-side probe. `-r` preserves an already-granted\n# USB permission on retries. It never touches the canonical staging package.\necho "Installing/updating side-by-side SDK 5.8 probe (canonical app remains installed)..."\n"$ADB" -s "$SERIAL" install -r "$APK" >/dev/null\n# Runtime location permission is package-specific. Grant it explicitly on this\n# diagnostic package; USB permission itself remains Android-controlled.\n"$ADB" -s "$SERIAL" shell pm grant "$NEW_PKG" android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1 || true\necho "Probe location permission requested via ADB."\necho "IMPORTANT: if the tablet shows an Android USB access dialog for WisePad 3, tap Allow once."'''
if old not in src:
    raise SystemExit('ERROR: expected probe-install block not found')
src=src.replace(old,new,1)

old_loop='for attempt in $(seq 1 20); do'
new_loop='for attempt in $(seq 1 45); do'
if old_loop not in src:
    raise SystemExit('ERROR: readiness loop marker not found')
src=src.replace(old_loop,new_loop,1)
src=src.replace('within 40 seconds','within 90 seconds',1)

# Add fail-closed source contract checks before the probe build.
marker='''RUNTIME="$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java"\ngrep -q 'processPaymentIntent' "$RUNTIME" || { echo "ERROR: processPaymentIntent missing" >&2; exit 7; }'''
replacement='''RUNTIME="$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/StripeTerminalReaderRuntime.java"\nGRADLE="$ROOT/android-kiosk/app/build.gradle.kts"\ngrep -q 'processPaymentIntent' "$RUNTIME" || { echo "ERROR: processPaymentIntent missing" >&2; exit 7; }\ngrep -q 'create("sdk58Probe")' "$GRADLE" || { echo "ERROR: sdk58Probe build type missing" >&2; exit 71; }\ngrep -q 'applicationIdSuffix = ".sdk58probe"' "$GRADLE" || { echo "ERROR: probe package isolation missing" >&2; exit 72; }\ngrep -q 'buildConfigField("boolean", "HARDWARE_EJECTION_ENABLED", "false")' "$GRADLE" || { echo "ERROR: probe ejection gate missing" >&2; exit 73; }'''
if marker not in src:
    raise SystemExit('ERROR: runtime gate marker not found')
src=src.replace(marker,replacement,1)

# Never leave the operator staring at a silent Gradle command. Show dependency
# resolution live while retaining a copy for the Stripe 5.8 gate, and announce
# task discovery explicitly.
old_dep='''./gradlew --no-daemon -q :app:dependencies --configuration sdk58ProbeRuntimeClasspath > "$TMP/deps.txt"'''
new_dep='''echo "[1/4] Resolving SDK 5.8 probe dependencies (live output)..."\n./gradlew --no-daemon --console=plain :app:dependencies --configuration sdk58ProbeRuntimeClasspath | tee "$TMP/deps.txt"\necho "[1/4] Dependency resolution complete."'''
if old_dep not in src:
    raise SystemExit('ERROR: dependency-resolution marker not found')
src=src.replace(old_dep,new_dep,1)

old_tasks='''TASKS="$(./gradlew --no-daemon -q :app:tasks --all)"'''
new_tasks='''echo "[2/4] Discovering Gradle tasks..."\nTASKS="$(./gradlew --no-daemon -q :app:tasks --all)"\necho "[2/4] Task discovery complete."'''
if old_tasks not in src:
    raise SystemExit('ERROR: task-discovery marker not found')
src=src.replace(old_tasks,new_tasks,1)

old_build='''./gradlew --no-daemon clean :app:testDebugUnitTest "$LINT_TASK" :app:assembleSdk58Probe'''
new_build='''echo "[3/4] Running unit tests + lint + SDK 5.8 probe APK build..."\n./gradlew --no-daemon --console=plain clean :app:testDebugUnitTest "$LINT_TASK" :app:assembleSdk58Probe\necho "[3/4] APK build complete."'''
if old_build not in src:
    raise SystemExit('ERROR: build marker not found')
src=src.replace(old_build,new_build,1)

out.write_text(src,encoding='utf-8')
PY
chmod +x "$TMP"
exec bash "$TMP"
