plugins {
    id("com.android.application")
}

val enrollmentUrl = providers.gradleProperty("chargeursEnrollmentUrl")
    .orElse(providers.environmentVariable("CHARGEURS_ENROLLMENT_URL"))
    .orElse("")
val kioskPublicBaseUrl = providers.gradleProperty("chargeursKioskPublicBaseUrl")
    .orElse(providers.environmentVariable("CHARGEURS_KIOSK_PUBLIC_BASE_URL"))
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

// STAGING only: CI materializes a persistent test keystore and passes its
// absolute path explicitly. Local builds keep the normal Android debug signer
// when this value is absent. This is never used for the production release.
val stagingStorePath = providers.environmentVariable("CHARGEURS_STAGING_KEYSTORE_PATH").orElse("")
val stagingSigningReady = stagingStorePath.get().isNotBlank() && file(stagingStorePath.get()).isFile

val stagingEnrollmentUrl = "https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/kiosk-enroll"
val stagingKioskPublicBaseUrl = "https://chargeurs-ch-staging.vercel.app"
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
        versionCode = 122
        versionName = "1.0.22-terminal-compat-v2-core"

        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
        buildConfigField("String", "ENROLLMENT_URL", quotedBuildConfig(enrollmentUrl.get()))
        buildConfigField("String", "KIOSK_PUBLIC_BASE_URL", quotedBuildConfig(kioskPublicBaseUrl.get()))
        buildConfigField("String", "STRIPE_TERMINAL_BACKEND_URL", quotedBuildConfig(terminalBackendUrl.get()))
        buildConfigField("String", "EJECTION_PUBLIC_KEY_BASE64", quotedBuildConfig(ejectionPublicKey.get()))
        buildConfigField("boolean", "HARDWARE_EJECTION_ENABLED", "false")
        buildConfigField("boolean", "LEGACY_DEVICE_BOUND_STORAGE_ENABLED", "false")
        buildConfigField("String", "BUILD_ENVIRONMENT", "\"staging\"")
        buildConfigField("boolean", "STRIPE_TERMINAL_USB_TEST_ENABLED", "false")
        manifestPlaceholders["kioskHomeEnabled"] = "true"
        manifestPlaceholders["bootReceiverEnabled"] = "true"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (stagingSigningReady) {
            create("stagingTest") {
                storeFile = file(stagingStorePath.get())
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
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
            buildConfigField(
                "String",
                "KIOSK_PUBLIC_BASE_URL",
                quotedBuildConfig(kioskPublicBaseUrl.get().ifBlank { stagingKioskPublicBaseUrl }),
            )
            manifestPlaceholders["kioskHomeEnabled"] = "false"
            manifestPlaceholders["bootReceiverEnabled"] = "false"
        }
        create("staging") {
            initWith(getByName("debug"))
            if (stagingSigningReady) signingConfig = signingConfigs.getByName("stagingTest")
            applicationIdSuffix = ".staging"
            versionNameSuffix = "-staging"
            buildConfigField("boolean", "STRIPE_TERMINAL_USB_TEST_ENABLED", "true")
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

    // Stripe 2.22's legacy BBPOS USB adapter references ContextCompat directly
    // but does not package AndroidX Core into this application transitively.
    // Keep this explicit in the TEST-only lane and assert the class in DEX CI.
    implementation("androidx.core:core:1.13.1")

    testImplementation("junit:junit:4.13.2")
}
