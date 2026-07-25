plugins {
    id("com.android.application")
}

val enrollmentUrl = providers.gradleProperty("chargeursEnrollmentUrl")
    .orElse(providers.environmentVariable("CHARGEURS_ENROLLMENT_URL"))
    .orElse("")
val kioskPublicBaseUrl = providers.gradleProperty("chargeursKioskPublicBaseUrl")
    .orElse(providers.environmentVariable("CHARGEURS_KIOSK_PUBLIC_BASE_URL"))
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

val stagingEnrollmentUrl = "https://xqepbqnaenoeyfjkjnzl.supabase.co/functions/v1/kiosk-enroll-diagnostic"
val stagingKioskPublicBaseUrl = "https://chargeurs-ch-staging.vercel.app"

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
        versionCode = 120
        versionName = "1.2.0"

        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
        buildConfigField("String", "ENROLLMENT_URL", quotedBuildConfig(enrollmentUrl.get()))
        buildConfigField("String", "KIOSK_PUBLIC_BASE_URL", quotedBuildConfig(kioskPublicBaseUrl.get()))
        buildConfigField("String", "EJECTION_PUBLIC_KEY_BASE64", quotedBuildConfig(ejectionPublicKey.get()))
        manifestPlaceholders["kioskHomeEnabled"] = "true"
        manifestPlaceholders["bootReceiverEnabled"] = "true"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
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
            applicationIdSuffix = ".freetest"
            versionNameSuffix = "-local"
            isDebuggable = true
            buildConfigField(
                "String",
                "ENROLLMENT_URL",
                quotedBuildConfig(enrollmentUrl.get().ifBlank { stagingEnrollmentUrl }),
            )
            buildConfigField(
                "String",
                "KIOSK_PUBLIC_BASE_URL",
                quotedBuildConfig(kioskPublicBaseUrl.get().ifBlank { stagingKioskPublicBaseUrl }),
            )
            manifestPlaceholders["kioskHomeEnabled"] = "false"
            manifestPlaceholders["bootReceiverEnabled"] = "false"
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
    testImplementation("junit:junit:4.13.2")
}
