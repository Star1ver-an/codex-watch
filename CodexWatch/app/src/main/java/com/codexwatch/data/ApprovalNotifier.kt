package com.codexwatch.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.codexwatch.R

object ApprovalNotifier {
    const val CHANNEL_ID = "approvals"
    const val NOTIFICATION_ID = 1001

    fun ensureChannel(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            "审批请求",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Codex 审批请求通知"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 400, 200, 400, 200, 400)
        }
        nm.createNotificationChannel(channel)
    }

    fun show(context: Context, threadTitle: String, approval: ApprovalEntry) {
        ensureChannel(context)
        val approvePi = PendingIntent.getBroadcast(
            context,
            (approval.id + "a").hashCode(),
            Intent(context, ApprovalReceiver::class.java)
                .putExtra("id", approval.id)
                .putExtra("approve", true),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val rejectPi = PendingIntent.getBroadcast(
            context,
            (approval.id + "r").hashCode(),
            Intent(context, ApprovalReceiver::class.java)
                .putExtra("id", approval.id)
                .putExtra("approve", false),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(approval.title)
            .setContentText(approval.detail)
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("任务: ${threadTitle.replace(Regex("\\s+"), " ")}\n${approval.detail}")
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .addAction(0, "批准", approvePi)
            .addAction(0, "拒绝", rejectPi)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted; in-app card still works
        }
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }
}
