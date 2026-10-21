plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.unofficial.pokebonk"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.unofficial.pokebonk"
        minSdk = 26
        targetSdk = 34
        versionCode = 10
        versionName = "1.9"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signs the optimized release build automatically so it installs on any phone
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.0")
}
