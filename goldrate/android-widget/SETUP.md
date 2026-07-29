# Gold rate widget — setup

## 1. Files go here

```
app/src/main/java/com/yourname/goldrate/
    RateRepository.kt      network + local cache
    RateWidget.kt          the widget UI (Glance)
    RefreshWorker.kt       15-minute background refresh
app/src/main/res/xml/
    rate_widget_info.xml
```

Change the package name at the top of each Kotlin file to your own.

## 2. Point it at your server

In `RateRepository.kt`, set `ENDPOINT` to your deployed backend.
Testing on the emulator? Use `http://10.0.2.2:3000/api/rate` — that is
how the emulator reaches your laptop's localhost. Plain http needs
`android:usesCleartextTraffic="true"` in the manifest for testing only.

## 3. Start the background refresh

In `MainActivity.onCreate`:

```kotlin
RefreshWorker.schedule(this)
```

## 4. After the app screen fetches, redraw the widget

```kotlin
lifecycleScope.launch {
    RateRepository.refresh(this@MainActivity)
    RateWidget().updateAll(this@MainActivity)
}
```

This is why tapping the widget feels instant: it opens the app, the app
fetches, and the widget is redrawn on the way back out.

## Things that will bite you

- **Widgets cannot update every minute.** 15 min is WorkManager's floor,
  30 min is the manifest floor. Design around it, don't fight it.
- **Doze mode** stretches intervals further when the phone sits idle
  overnight. Expected. The timestamp keeps you honest.
- **No network calls inside `provideGlance`.** It must render instantly
  from cache, or the widget shows blank while it waits.
- **Battery optimisation** on Xiaomi, Oppo, Vivo and Realme is far more
  aggressive than stock Android. Most of your jewellers will be on these.
  Test on a real Xiaomi before you promise anything about refresh timing.
