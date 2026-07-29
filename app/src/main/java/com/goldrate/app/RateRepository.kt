package com.goldrate.app

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Talks to your own backend (/api/rate) and remembers the last good answer.
 *
 * Nothing here knows about widgets — the app screen uses it too.
 * Shops have bad signal, so the cached value is not a fallback,
 * it is the normal case.
 */
object RateRepository {

    private const val ENDPOINT = "https://bhav-tau.vercel.app/api/rate"

    private const val PREFS = "rate_cache"
    private const val KEY_GOLD_999 = "gold999"
    private const val KEY_GOLD_916 = "gold916"
    private const val KEY_SILVER_KG = "silverKg"
    private const val KEY_FETCHED_AT = "fetchedAt"

    data class Rate(
        val gold999Per10g: Double,
        val gold916Per10g: Double,
        val silver999PerKg: Double?,
        val fetchedAt: Long
    ) {
        /** "10:42 AM" — a timestamp jewellers can judge for themselves. */
        val clock: String
            get() = SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(fetchedAt))

        val ageMinutes: Long
            get() = (System.currentTimeMillis() - fetchedAt) / 60_000
    }

    /** Last saved value, or null if the app has never fetched successfully. */
    fun cached(context: Context): Rate? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val at = p.getLong(KEY_FETCHED_AT, 0L)
        if (at == 0L) return null
        val silver = p.getFloat(KEY_SILVER_KG, -1f)
        return Rate(
            gold999Per10g = p.getFloat(KEY_GOLD_999, 0f).toDouble(),
            gold916Per10g = p.getFloat(KEY_GOLD_916, 0f).toDouble(),
            silver999PerKg = if (silver < 0f) null else silver.toDouble(),
            fetchedAt = at
        )
    }

    /**
     * Fetches a fresh rate and saves it.
     * Returns the cached value on failure instead of throwing — a rate
     * board that goes blank is worse than one showing an older number.
     */
    suspend fun refresh(context: Context): Rate? = withContext(Dispatchers.IO) {
        try {
            val conn = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
                connectTimeout = 8_000
                readTimeout = 8_000
                requestMethod = "GET"
            }

            val body = conn.inputStream.bufferedReader().use { it.readText() }
            conn.disconnect()

            val json = JSONObject(body)
            val gold = json.getJSONObject("gold")
            // The API returns a JSON null (not a missing key) whenever its
            // own silver source failed — optJSONObject treats both the same,
            // getJSONObject would throw on the null and crash the refresh.
            val silver = json.optJSONObject("silver")

            val previousSilver = cached(context)?.silver999PerKg

            val rate = Rate(
                gold999Per10g = gold.getDouble("per10g999"),
                gold916Per10g = gold.getDouble("per10g916"),
                silver999PerKg = silver?.getDouble("perKg999") ?: previousSilver,
                fetchedAt = System.currentTimeMillis()
            )

            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
                putFloat(KEY_GOLD_999, rate.gold999Per10g.toFloat())
                putFloat(KEY_GOLD_916, rate.gold916Per10g.toFloat())
                putFloat(KEY_SILVER_KG, (rate.silver999PerKg ?: -1.0).toFloat())
                putLong(KEY_FETCHED_AT, rate.fetchedAt)
                apply()
            }

            rate
        } catch (e: Exception) {
            android.util.Log.w("RateRepository", "refresh failed: ${e.message}")
            cached(context)
        }
    }

    /** 156786.4 -> "1,56,786" — Indian digit grouping, no paise. */
    fun inr(value: Double): String {
        val n = value.toLong()
        val s = n.toString()
        if (s.length <= 3) return s
        val last3 = s.takeLast(3)
        val rest = s.dropLast(3)
        val grouped = rest.reversed().chunked(2).joinToString(",").reversed()
        return "$grouped,$last3"
    }
}
