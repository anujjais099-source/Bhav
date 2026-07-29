package com.goldrate.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.glance.appwidget.updateAll
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * The app is a thin shell around the live site — same reasoning as the
 * widget's "never blank the board" rule: one source of truth (the website)
 * instead of a second UI to keep visually in sync by hand.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = WebViewClient() // keep navigation inside the app
            loadUrl("https://bhav-tau.vercel.app/")
        }
        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        // Keep the widget's cache warm every time the app is opened,
        // on top of RefreshWorker's own 15-minute background cycle.
        RefreshWorker.schedule(this)
        lifecycleScope.launch {
            RateRepository.refresh(this@MainActivity)
            RateWidget().updateAll(this@MainActivity)
        }
    }
}
