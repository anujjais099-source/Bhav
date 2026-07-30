package com.goldrate.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.annotation.SuppressLint
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
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
 *
 * A branded splash covers the WebView's own load time (network fetch +
 * first paint of the site's JS) so the user sees the Bhav-tau mark instead
 * of a blank white flash, and stays up a minimum time so it never flickers
 * away instantly on a fast/cached load.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var splashView: View

    private val handler = Handler(Looper.getMainLooper())
    private val splashStartedAt = System.currentTimeMillis()
    private val minSplashMillis = 1100L
    private var webViewReady = false
    private var splashDismissed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        splashView = findViewById(R.id.splashView)
        webView = findViewById(R.id.webview)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                webViewReady = true
                dismissSplashWhenReady()
            }
        }
        webView.loadUrl("https://bhav-tau.vercel.app/")

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

    /** Never shows the splash for less than minSplashMillis, never longer than needed. */
    private fun dismissSplashWhenReady() {
        val elapsed = System.currentTimeMillis() - splashStartedAt
        val remaining = (minSplashMillis - elapsed).coerceAtLeast(0)
        handler.postDelayed({ crossfadeToWebView() }, remaining)
    }

    private fun crossfadeToWebView() {
        if (splashDismissed || !webViewReady) return
        splashDismissed = true

        webView.alpha = 0f
        webView.visibility = View.VISIBLE
        webView.animate().alpha(1f).setDuration(250).start()

        splashView.animate()
            .alpha(0f)
            .setDuration(250)
            .setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    splashView.visibility = View.GONE
                }
            })
            .start()
    }
}
