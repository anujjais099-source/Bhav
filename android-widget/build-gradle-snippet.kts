// app/build.gradle.kts — add to dependencies { }
// Check for newer versions before you copy these in.

dependencies {
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}

// Glance needs Compose enabled:
android {
    buildFeatures { compose = true }
}
