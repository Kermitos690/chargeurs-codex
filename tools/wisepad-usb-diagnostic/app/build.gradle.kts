plugins {
    id("com.android.application")
}

android {
    namespace = "ch.chargeurs.usbdiag"
    compileSdk = 36

    defaultConfig {
        applicationId = "ch.chargeurs.usbdiag"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        debug {
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        disable += setOf("OldTargetApi")
    }
}
