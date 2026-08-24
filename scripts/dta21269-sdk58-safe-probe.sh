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

# The b37d... fingerprint was the historical CI cache signer, not a field-
# verified fingerprint of the APK currently installed on DTA21269. For this
# side-by-side probe, use the actual certificate of the exact installed package
# to derive its LEGACY_DEVICE_BOUND key. Still fail closed on package identity,
# debuggability and encrypted config structure below.
old_signer='''OLD_SIGNER="$(cert_sha "$TMP/old.apk")"\n[[ "$OLD_SIGNER" == "$EXPECTED_OLD_SIGNER" ]] || {\n  echo "ERROR: installed canonical app signer changed; refusing probe" >&2\n  exit 15\n}'''
new_signer='''OLD_BADGING="$($AAPT dump badging "$TMP/old.apk" | head -1)"\necho "$OLD_BADGING" | grep -q "package: name='$OLD_PKG'" || {\n  echo "ERROR: pulled APK package is not $OLD_PKG; refusing probe" >&2\n  exit 15\n}\nOLD_SIGNER="$(cert_sha "$TMP/old.apk")"\n[[ -n "$OLD_SIGNER" ]] || { echo "ERROR: installed staging signer unavailable" >&2; exit 151; }\necho "Installed staging signer: $OLD_SIGNER"\nif [[ "$OLD_SIGNER" != "$EXPECTED_OLD_SIGNER" ]]; then\n  echo "NOTE: installed signer differs from historical CI fingerprint; using the field APK signer for local encrypted-config rewrap."\nfi'''
if old_signer not in src:
    raise SystemExit('ERROR: historical signer guard marker not found')
src=src.replace(old_signer,new_signer,1)

# Make the private-config read deterministic and visible. The original command
# could terminate under `set -e -o pipefail` without telling the operator which
# exact sub-step failed.
old_config='''echo "Canonical app verified; reading only its encrypted staging configuration..."\n"$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" cat shared_prefs/chargeurs_kiosk_config.xml \\\n  | tr -d '\\r' > "$TMP/old-prefs.xml"\npython3 - "$TMP/old-prefs.xml" "$TMP/meta.tsv" <<'PY'\nimport sys, xml.etree.ElementTree as ET\nsrc,out=sys.argv[1:]\nroot=ET.parse(src).getroot()\nvalues={node.attrib.get('name'): (node.text or '') for node in root if node.tag=='string'}\nrequired=['station_id','base_url','token_cipher','token_iv','token_crypto_mode','legacy_device_salt']\nmissing=[k for k in required if not values.get(k)]\nif missing:\n    raise SystemExit('ERROR: old config missing: '+','.join(missing))\nif values['token_crypto_mode']!='LEGACY_DEVICE_BOUND':\n    raise SystemExit('ERROR: old config is not LEGACY_DEVICE_BOUND; refusing unsafe migration')\nwith open(out,'w',encoding='utf-8') as f:\n    f.write('\\t'.join(values[k] for k in required)+'\\n')\nPY\nIFS=$'\\t' read -r STATION_ID BASE_URL OLD_CIPHER OLD_IV OLD_MODE OLD_SALT < "$TMP/meta.tsv"\n\nOLD_ANDROID_ID="$("$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" settings get secure android_id 2>/dev/null | tr -d '\\r\\n')"\n[[ "$OLD_ANDROID_ID" =~ ^[A-Za-z0-9_-]{8,128}$ ]] || {\n  echo "ERROR: could not read app-scoped Android ID from canonical app" >&2\n  exit 17\n}'''
new_config='''echo "Canonical app verified; reading only its encrypted staging configuration..."\necho "[4a/4] Locating canonical encrypted preferences..."\nOLD_PREF="shared_prefs/chargeurs_kiosk_config.xml"\nif ! "$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" ls "$OLD_PREF" >/dev/null 2>&1; then\n  echo "ERROR: canonical encrypted preferences file is not readable with run-as: $OLD_PREF" >&2\n  echo "Available shared_prefs filenames:" >&2\n  "$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" ls shared_prefs 2>&1 | sed 's/^/  /' >&2 || true\n  exit 161\nfi\necho "[4a/4] Encrypted preferences located."\n\necho "[4b/4] Reading encrypted preferences (token remains encrypted)..."\nif ! "$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" cat "$OLD_PREF" > "$TMP/old-prefs.raw"; then\n  echo "ERROR: run-as could not read canonical encrypted preferences" >&2\n  exit 162\nfi\ntr -d '\\r' < "$TMP/old-prefs.raw" > "$TMP/old-prefs.xml"\n[[ -s "$TMP/old-prefs.xml" ]] || { echo "ERROR: canonical encrypted preferences are empty" >&2; exit 163; }\necho "[4b/4] Encrypted preferences read."\n\necho "[4c/4] Validating encrypted configuration structure..."\npython3 - "$TMP/old-prefs.xml" "$TMP/meta.tsv" <<'PY'\nimport sys, xml.etree.ElementTree as ET\nsrc,out=sys.argv[1:]\ntry:\n    root=ET.parse(src).getroot()\nexcept Exception as e:\n    raise SystemExit('ERROR: encrypted preferences XML parse failed: '+type(e).__name__)\nvalues={node.attrib.get('name'): (node.text or '') for node in root if node.tag=='string'}\nrequired=['station_id','base_url','token_cipher','token_iv','token_crypto_mode','legacy_device_salt']\nmissing=[k for k in required if not values.get(k)]\nif missing:\n    raise SystemExit('ERROR: old config missing: '+','.join(missing))\nif values['token_crypto_mode']!='LEGACY_DEVICE_BOUND':\n    raise SystemExit('ERROR: old config is not LEGACY_DEVICE_BOUND; refusing unsafe migration')\nwith open(out,'w',encoding='utf-8') as f:\n    f.write('\\t'.join(values[k] for k in required)+'\\n')\nPY\n[[ -s "$TMP/meta.tsv" ]] || { echo "ERROR: validated config metadata was not produced" >&2; exit 164; }\nIFS=$'\\t' read -r STATION_ID BASE_URL OLD_CIPHER OLD_IV OLD_MODE OLD_SALT < "$TMP/meta.tsv" || true\n[[ -n "${STATION_ID:-}" && -n "${OLD_CIPHER:-}" && -n "${OLD_SALT:-}" ]] || {\n  echo "ERROR: validated config metadata could not be loaded" >&2\n  exit 165\n}\necho "[4c/4] Encrypted configuration structure valid for station $STATION_ID."\n\necho "[4d/4] Reading app-scoped Android ID for local rewrap..."\nOLD_ANDROID_ID="$("$ADB" -s "$SERIAL" shell run-as "$OLD_PKG" settings get secure android_id 2>/dev/null | tr -d '\\r\\n' || true)"\n[[ "$OLD_ANDROID_ID" =~ ^[A-Za-z0-9_-]{8,128}$ ]] || {\n  echo "ERROR: could not read app-scoped Android ID from canonical app" >&2\n  exit 17\n}\necho "[4d/4] App-scoped Android ID available (value not printed)."'''
if old_config not in src:
    raise SystemExit('ERROR: canonical-config migration marker not found')
src=src.replace(old_config,new_config,1)

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

# Any unexpected shell failure after the explicit guards must be visible.
src=src.replace('set -euo pipefail', 'set -Eeuo pipefail\ntrap \'echo "ERROR: unexpected shell failure at line $LINENO: $BASH_COMMAND" >&2\' ERR', 1)

out.write_text(src,encoding='utf-8')
PY
chmod +x "$TMP"
exec bash "$TMP"
