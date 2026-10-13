package com.codexwatch.complications

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import com.codexwatch.CodexWatchApp
import com.codexwatch.MainActivity

class StatusComplicationService : ComplicationDataSourceService() {

    override fun onComplicationRequest(request: ComplicationRequest, listener: ComplicationRequestListener) {
        listener.onComplicationData(buildData())
    }

    override fun getPreviewData(type: ComplicationType): ComplicationData = buildData()

    private fun buildData(): ComplicationData {
        val vm = try { (applicationContext as CodexWatchApp).vm } catch (e: Exception) { null }
        val ui = vm?.ui?.value
        val running = ui?.threads?.count { it.phase == "running" } ?: 0
        val waiting = ui?.threads?.sumOf { it.pendingApprovals.size } ?: 0
        val connected = ui?.conn == com.codexwatch.data.ConnState.CONNECTED

        val text = if (waiting > 0) "审批 $waiting" else "运行 $running"
        val title = when {
            ui?.conn != com.codexwatch.data.ConnState.CONNECTED -> "离线"
            waiting > 0 -> "Codex 审批!"
            else -> "Codex"
        }

        val tap = PendingIntent.getActivity(
            applicationContext,
            0,
            Intent(applicationContext, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return ShortTextComplicationData.Builder(
            PlainComplicationText.Builder(text).build(),
            PlainComplicationText.Builder("Codex Watch 状态").build()
        )
            .setTitle(PlainComplicationText.Builder(title).build())
            .setTapAction(tap)
            .build()
    }
}
