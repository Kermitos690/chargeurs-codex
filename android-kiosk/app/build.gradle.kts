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

// STAGING field APKs need a durable signing identity. A runner-local Android
// debug key changes between hosted runners and makes `adb install -r` unsafe.
// CI materializes the keystore from a repository secret into RUNNER_TEMP and
// supplies these four values. Local developer builds may still use the normal
// debug signer, but those APKs are validation-only and must not be deployed to
// a DTA field tablet as the durable bootstrap package.
val stagingStorePath = providers.environmentVariable("CHARGEURS_STAGING_KEYSTORE_PATH").orElse("")
val stagingStorePassword = providers.environmentVariable("CHARGEURS_STAGING_KEYSTORE_PASSWORD").orElse("")
val stagingKeyAlias = providers.environmentVariable("CHARGEURS_STAGING_KEY_ALIAS").orElse("")
val stagingKeyPassword = providers.environmentVariable("CHARGEURS_STAGING_KEY_PASSWORD").orElse("")
val stagingSigningReady = listOf(
    stagingStorePath.get(), stagingStorePassword.get(), stagingKeyAlias.get(), stagingKeyPassword.get(),
).all { it.isNotBlank() } && file(stagingStorePath.get()).isFile

// Enrollment and WebView navigation remain pinned to the stable STAGING
// origin. Preview deployments are protected by Vercel SSO and must never be
// embedded in a field APK; keeping the public origin unchanged also preserves
// the durable kiosk credential during an in-place update.
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
        versionCode = 129
        versionName = "1.0.29-operator-recovery"

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
        }
        create("staging") {
            initWith(getByName("debug"))
            if (stagingSigningReady) signingConfig = signingConfigs.getByName("stagingPersistent")
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            // Dedicated field-test lane: DTA21269 uses its attached BBPOS
            // WisePad 3 over USB. The simulated reader is excluded so the UI
            // can never represent a simulated reader as physical hardware.
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
        disable += setOf("OldTargetApi", "GradleDependency")
    }
}

dependencies {
    // TEST-ONLY compatibility lane for DTA21269. Stripe 2.22.0 is the first
    // release where WisePad 3 USB connectivity is GA and predates the modern
    // offline-mode initialization that fails against this kiosk's broken
    // Android 11 Keymaster. Never promote this dependency to production.
    implementation("com.stripe:stripeterminal:2.22.0")

    // Stripe 2.22's legacy BBPOS adapter references ContextCompat directly but
    // does not package AndroidX Core into this application transitively.
    implementation("androidx.core:core:1.13.1")

    testImplementation("junit:junit:4.13.2")
}
