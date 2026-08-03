#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN="$ROOT/android-kiosk/app/src/main/java/ch/chargeurs/kiosk/MainActivity.java"
GRADLE="$ROOT/android-kiosk/app/build.gradle.kts"

# The visual fix belongs in source control. This guard deliberately fails if a
# future build tries to recreate an APK by mutating Java/Kotlin or Gradle files
# only inside CI.
grep -F "private static final int WEB_VIEW_LAYER_INDEX = 1;" "$MAIN"
grep -F "container.addView(webView, WEB_VIEW_LAYER_INDEX, webParams);" "$MAIN"
grep -F "versionCode = 115" "$GRADLE"
grep -F 'versionName = "1.0.15"' "$GRADLE"

cd "$ROOT/android-kiosk"
chmod +x ./gradlew
./gradlew --no-daemon testDebugUnitTest lintStaging assembleStaging

APK="app/build/outputs/apk/staging/app-staging.apk"
OUT="$ROOT/Chargeurs_CH_Kiosk_1.0.15-staging.apk"
test -s "$APK"
cp "$APK" "$OUT"
sha256sum "$OUT" | tee "$ROOT/Chargeurs_CH_Kiosk_1.0.15-staging.sha256"
