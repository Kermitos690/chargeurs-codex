plugins {
    id("com.android.application")
}

val enrollmentUrl = providers.gradleProperty("chargeursEnrollmentUrl")
    .orElse(providers.environmentVariable("CHARGEURS_ENROLLMENT_URL"))
    .orElse("")
val kioskPublicBaseUrl = providers.gradleProperty("chargeursKioskPublicBaseUrl")
    .orElse(providers.environmentVariable("CHARGEURS_KIOSK_PUBLIC_BASE_URL"))
    .orElse("")
val kioskWebBaseUrl = providers.gradleProperty("chargeursKioskWebBaseUrl")
    .orElse(providers.environmentVariable("CHARGEURS_KIOSK_WEB_BASE_URL"))
    .orElse("")
val terminalBackendUrl = providers.gradleProperty("chargeursStripeTerminalBackendUrl")
    .orElse(providers.environmentVariable("CHARGEURS_STRIPE_TERMINAL_BACKEND_URL"))
    .orElse("")
val ejectionPublicKey = providers.gradleProperty("chargeursEjectionPublicKeyBase64")
    .orElse(providers.environmentVariable("CHARGEURS_EJECTION_PUBLIC_KEY_BASE64"))
    .orElse("")
val releaseStorePath = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orElse("")
val releaseStorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orElse("")
val releaseKeyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orElse("")
val releaseKeyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orElse("")
val releaseSigningReady = listOf(
    releaseStorePath.get(), releaseStorePassword.get(), releaseKeyAlias.get(), releaseKeyPassword.get(),
).all { it.isNotBlank() } && file(releaseStorePath.get()).isFile

// Field STAGING builds must keep a durable signing identity so DTA21269 can be
// upgraded in place. CI may materialize the known staging key into RUNNER_TEMP;
// local validation builds can still fall back to Android's debug signer.
val stagingStorePath = providers.environmentVariable("CHARGEURS_STAGING_KEYSTORE_PATH").orElse("")
val stagingStorePassword = providers.environmentVariable("CHARGEURS_STAGING_KEYSTORE_PASSWORD").orElse("")
val stagingKeyAlias = providers.environmentVariable("CHARGEURS_STAGING_KEY_ALIAS").orElse("")
val stagingKeyPassword = providers.environmentVariable("CHARGEURS_STAGING_KEY_PASSWORD").orElse("")
val stagingSigningReady = listOf(
    stagingStorePath.get(), stagingStorePassword.get(), stagingKeyAlias.get(), stagingKeyPassword.get(),
).all { it.isNotBlank() } && file(stagingStorePath.get()).isFile

val stagingEnrollmentUrl = "https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/kiosk-enroll"
val stagingKioskPublicBaseUrl = "https://chargeurs-ch-staging.vercel.app"
val stagingKioskWebBaseUrl = "https://chargeurs-ch-staging.vercel.app"
val stagingTerminalBackendUrl = "https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/stripe-terminal-backend"

fun quotedBuildConfig(value: String): String = "\"" + value
    .replace("\\", "\\\\")
    .replace("\"", "\\\"") + "\""

android {
    namespace = "ch.chargeurs.kiosk"
    compileSdk = 36

    defaultConfig {
        applicationId = "ch.chargeurs.kiosk"
        minSdk = 26
        targetSdk = 36
        // The DTA21269 currently runs versionCode 141. A normal Android
        // upgrade must increase this value; no downgrade install is permitted.
        versionCode = 144
        versionName = "1.0.44-terminal-cancel-authoritative"

        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
        buildConfigField("String", "ENROLLMENT_URL", quotedBuildConfig(enrollmentUrl.get()))
        buildConfigField("String", "KIOSK_PUBLIC_BASE_URL", quotedBuildConfig(kioskPublicBaseUrl.get()))
        buildConfigField(
            "String",
            "KIOSK_WEB_BASE_URL",
            quotedBuildConfig(kioskWebBaseUrl.get().ifBlank { kioskPublicBaseUrl.get() }),
        )
        buildConfigField("String", "STRIPE_TERMINAL_BACKEND_URL", quotedBuildConfig(terminalBackendUrl.get()))
        buildConfigField("String", "EJECTION_PUBLIC_KEY_BASE64", quotedBuildConfig(ejectionPublicKey.get()))
        buildConfigField("boolean", "HARDWARE_EJECTION_ENABLED", "false")
        buildConfigField("boolean", "LEGACY_DEVICE_BOUND_STORAGE_ENABLED", "false")
        buildConfigField("String", "BUILD_ENVIRONMENT", "\"staging\"")
        buildConfigField("boolean", "STRIPE_TERMINAL_USB_TEST_ENABLED", "false")
        buildConfigField("boolean", "STRIPE_TERMINAL_SIMULATED_TEST_ENABLED", "false")
        manifestPlaceholders["kioskHomeEnabled"] = "true"
        manifestPlaceholders["bootReceiverEnabled"] = "true"
        manifestPlaceholders["terminalDiagnosticExported"] = "false"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (stagingSigningReady) {
            create("stagingPersistent") {
                storeFile = file(stagingStorePath.get())
                storePassword = stagingStorePassword.get()
                keyAlias = stagingKeyAlias.get()
                keyPassword = stagingKeyPassword.get()
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
        if (releaseSigningReady) {
            create("release") {
                storeFile = file(releaseStorePath.get())
                storePassword = releaseStorePassword.get()
                keyAlias = releaseKeyAlias.get()
                keyPassword = releaseKeyPassword.get()
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-diagnostic"
            isDebuggable = true
            buildConfigField(
                "String",
                "ENROLLMENT_URL",
                quotedBuildConfig(enrollmentUrl.get().ifBlank { stagingEnrollmentUrl }),
            )
            buildConfigField(
                "String",
                "STRIPE_TERMINAL_BACKEND_URL",
                quotedBuildConfig(terminalBackendUrl.get().ifBlank { stagingTerminalBackendUrl }),
            )
            buildConfigField("boolean", "LEGACY_DEVICE_BOUND_STORAGE_ENABLED", "true")
            buildConfigField("boolean", "STRIPE_TERMINAL_USB_TEST_ENABLED", "true")
            buildConfigField("boolean", "STRIPE_TERMINAL_SIMULATED_TEST_ENABLED", "false")
            buildConfigField(
                "String",
                "KIOSK_PUBLIC_BASE_URL",
                quotedBuildConfig(kioskPublicBaseUrl.get().ifBlank { stagingKioskPublicBaseUrl }),
            )
            buildConfigField(
                "String",
                "KIOSK_WEB_BASE_URL",
                quotedBuildConfig(
                    kioskWebBaseUrl.get().ifBlank {
                        kioskPublicBaseUrl.get().ifBlank { stagingKioskPublicBaseUrl }
                    },
                ),
            )
            manifestPlaceholders["kioskHomeEnabled"] = "false"
            manifestPlaceholders["bootReceiverEnabled"] = "false"
            manifestPlaceholders["terminalDiagnosticExported"] = "true"
        }
        create("staging") {
            initWith(getByName("debug"))
            if (stagingSigningReady) signingConfig = signingConfigs.getByName("stagingPersistent")
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField("boolean", "STRIPE_TERMINAL_USB_TEST_ENABLED", "true")
            buildConfigField("boolean", "STRIPE_TERMINAL_SIMULATED_TEST_ENABLED", "false")
            buildConfigField(
                "String",
                "KIOSK_PUBLIC_BASE_URL",
                quotedBuildConfig(stagingKioskPublicBaseUrl),
            )
            buildConfigField(
                "String",
                "KIOSK_WEB_BASE_URL",
                quotedBuildConfig(kioskWebBaseUrl.get().ifBlank { stagingKioskWebBaseUrl }),
            )
            buildConfigField(
                "String",
                "STRIPE_TERMINAL_BACKEND_URL",
                quotedBuildConfig(terminalBackendUrl.get().ifBlank { stagingTerminalBackendUrl }),
            )
            manifestPlaceholders["kioskHomeEnabled"] = "true"
            manifestPlaceholders["bootReceiverEnabled"] = "true"
            manifestPlaceholders["terminalDiagnosticExported"] = "true"
            buildConfigField("boolean", "LEGACY_DEVICE_BOUND_STORAGE_ENABLED", "true")
        }
        release {
            if (releaseSigningReady) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            manifestPlaceholders["kioskHomeEnabled"] = "true"
            manifestPlaceholders["bootReceiverEnabled"] = "true"
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = true
        // The wrapper version is pinned for reproducible signed staging APKs;
        // availability of a newer Gradle patch must not hide application lint.
        disable += setOf("OldTargetApi", "GradleDependency", "AndroidGradlePluginVersion")
    }
}

dependencies {
    // Needed only to register the narrowly scoped handler for Stripe 3.0.0's
    // otherwise process-fatal offline-cache undeliverable exception.
    implementation("io.reactivex.rxjava3:rxjava:3.1.6")
    // SDK 3.0.0 is Stripe's first Android USB-compatible lane for WisePad 3.
    // This is a local compile probe only; it is not an installation decision.
    implementation("com.stripe:stripeterminal:3.0.0")
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
}
