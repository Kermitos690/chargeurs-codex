#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN="$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/MainActivity.java"
GRADLE="$ROOT/android-kiosk/app/build.gradle.kts"

python3 - "$MAIN" "$GRADLE" <<'PY'
from pathlib import Path
import sys

main = Path(sys.argv[1])
gradle = Path(sys.argv[2])

main_text = main.read_text(encoding="utf-8")
old_layer = "container.addView(webView, 0, webParams);"
new_layer = "container.addView(webView, 1, webParams);"
if old_layer not in main_text:
    raise SystemExit("Expected WebView layer insertion was not found")
main_text = main_text.replace(old_layer, new_layer, 1)
main.write_text(main_text, encoding="utf-8")

gradle_text = gradle.read_text(encoding="utf-8")
replacements = {
    "versionCode = 113": "versionCode = 114",
    'versionName = "1.0.13"': 'versionName = "1.0.14"',
}
for old, new in replacements.items():
    if old not in gradle_text:
        raise SystemExit(f"Expected version declaration not found: {old}")
    gradle_text = gradle_text.replace(old, new, 1)
gradle.write_text(gradle_text, encoding="utf-8")
PY

grep -F "container.addView(webView, 1, webParams);" "$MAIN"
grep -F "versionCode = 114" "$GRADLE"
grep -F 'versionName = "1.0.14"' "$GRADLE"

cd "$ROOT/android-kiosk"
chmod +x ./gradlew
./gradlew --no-daemon testDebugUnitTest lintStaging assembleStaging

APK="app/build/outputs/apk/staging/app-staging.apk"
OUT="$ROOT/Chargeurs_CH_Kiosk_1.0.14-staging.apk"
test -f "$APK"
cp "$APK" "$OUT"
sha256sum "$OUT" | tee "$ROOT/Chargeurs_CH_Kiosk_1.0.14-staging.sha256"
