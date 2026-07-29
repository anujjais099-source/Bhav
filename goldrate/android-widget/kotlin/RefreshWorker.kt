package com.yourname.goldrate

import android.content.Context
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Fetches the rate in the background and redraws every placed widget.
 *
 * 15 minutes is the shortest repeating interval Android allows, and the
 * system may stretch it when the phone is idle. That is fine for a rate
 * board — the timestamp on the widget tells the truth either way.
 */
class RefreshWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val rate = RateRepository.refresh(applicationContext)
        RateWidget().updateAll(applicationContext)
        return if (rate != null) Result.success() else Result.retry()
    }

    companion object {
        private const val NAME = "rate-refresh"

        /** Call once from MainActivity.onCreate — KEEP means it won't stack up. */
        fun schedule(context: Context) {
            val work = PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                work
            )
        }
    }
}
