package com.yourname.goldrate

import android.content.Context
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.action.actionStartActivity

/* Same palette as the website — the widget should feel like the same product. */
private val LAC = Color(0xFF6E1216)
private val GOLD = Color(0xFFD6A94A)
private val SILVER = Color(0xFFBFC7D0)
private val IVORY_DIM = Color(0xFFC9B694)

class RateWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        // Read the cache — do NOT do network work here. The widget must
        // render instantly; RefreshWorker is what goes to the network.
        val rate = RateRepository.cached(context)

        provideContent {
            GlanceTheme {
                Column(
                    modifier = GlanceModifier
                        .fillMaxSize()
                        .background(LAC)
                        .cornerRadius(16.dp)
                        .padding(14.dp)
                        // Tap opens the app, which fetches fresh immediately.
                        .clickable(actionStartActivity<MainActivity>()),
                    verticalAlignment = Alignment.Top
                ) {
                    Text(
                        text = "सोना 999 · 10 ग्राम",
                        style = TextStyle(
                            color = ColorProvider(IVORY_DIM),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium
                        )
                    )

                    Spacer(GlanceModifier.height(2.dp))

                    Text(
                        text = if (rate == null) "—" else "₹" + RateRepository.inr(rate.gold999Per10g),
                        style = TextStyle(
                            color = ColorProvider(GOLD),
                            fontSize = 28.sp,
                            fontWeight = FontWeight.Bold
                        )
                    )

                    Spacer(GlanceModifier.height(8.dp))

                    Row {
                        Text(
                            text = "चाँदी ",
                            style = TextStyle(
                                color = ColorProvider(IVORY_DIM),
                                fontSize = 12.sp
                            )
                        )
                        Text(
                            text = if (rate == null) "—" else "₹" + RateRepository.inr(rate.silver999PerKg) + "/kg",
                            style = TextStyle(
                                color = ColorProvider(SILVER),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                        )
                    }

                    Spacer(GlanceModifier.height(8.dp))

                    // The timestamp is the honesty. Never write "LIVE" here.
                    Text(
                        text = when {
                            rate == null -> "tap to load"
                            rate.ageMinutes > 180 -> "last ${rate.clock} · tap to update"
                            else -> rate.clock
                        },
                        style = TextStyle(
                            color = ColorProvider(IVORY_DIM),
                            fontSize = 10.sp
                        )
                    )
                }
            }
        }
    }
}

class RateWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = RateWidget()
}
