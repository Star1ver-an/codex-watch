package com.codexwatch.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.codexwatch.MainActivity
import com.codexwatch.R

object ApprovalNotifier {
    const val NOTIFICATION_ID = 1001
    private const val CHANNEL_LOW = "approvals_low"
    private const val CHANNEL_NORMAL = "approvals_normal"
    private const val CHANNEL_HIGH = "approvals_high"

    fun ensureChannels(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        NotificationChannel(CHANNEL_LOW, "低风险审批", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "低风险 Codex 审批请求"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 120, 100, 120)
            nm.createNotificationChannel(this)
        }
        NotificationChannel(CHANNEL_NORMAL, "中风险审批", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "中风险 Codex 审批请求"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 260, 160, 260)
            nm.createNotificationChannel(this)
        }
        NotificationChannel(CHANNEL_HIGH, "高风险审批", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "高风险 Codex 审批请求，必须在应用内强确认"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 520, 220, 520, 220, 520)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            nm.createNotificationChannel(this)
        }
    }

    private fun channelId(risk: String): String = when (risk) {
        "high" -> CHANNEL_HIGH
        "medium" -> CHANNEL_NORMAL
        else -> CHANNEL_LOW
    }

    private fun openAppIntent(context: Context): PendingIntent =
        PendingIntent.getActivity(
            context,
            1001,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun show(context: Context, threadTitle: String, approval: ApprovalEntry) {
        ensureChannels(context)
        val risk = approval.risk
        val builder = NotificationCompat.Builder(context, channelId(risk))
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(approval.title)
            .setContentText("${approvalRiskLabel(risk)} · ${threadTitle.replace(Regex("\\s+"), " ")}")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText(
                        buildString {
                            append("任务: ")
                            append(threadTitle.replace(Regex("\\s+"), " "))
                            append('\n')
                            append(approvalRiskLabel(risk))
                            approval.commandPreview?.let { append("\n命令: "); append(it) }
                            approval.targetPath?.let { append("\n目录: "); append(it) }
                            approval.affectedFiles.takeIf { it.isNotEmpty() }?.let {
                                append("\n文件: ")
                                append(it.take(3).joinToString("、"))
                                if (it.size > 3) append(" 等 ${it.size} 项")
                            }
                            append('\n')
                            append(approval.detail)
                        },
                    ),
            )
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(context))

        if (risk == "high") {
            builder
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setContentText("高风险 · 打开手表确认")
                .addAction(0, "打开确认", openAppIntent(context))
                .addAction(
                    0,
                    "拒绝",
                    PendingIntent.getBroadcast(
                        context,
                        (approval.id + "r").hashCode(),
                        Intent(context, ApprovalReceiver::class.java)
                            .putExtra("id", approval.id)
                            .putExtra("approve", false),
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
        } else {
            builder.setPriority(if (risk == "medium") NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            builder.addAction(
                0,
                "批准",
                PendingIntent.getBroadcast(
                    context,
                    (approval.id + "a").hashCode(),
                    Intent(context, ApprovalReceiver::class.java)
                        .putExtra("id", approval.id)
                        .putExtra("approve", true),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            builder.addAction(
                0,
                "拒绝",
                PendingIntent.getBroadcast(
                    context,
                    (approval.id + "r").hashCode(),
                    Intent(context, ApprovalReceiver::class.java)
                        .putExtra("id", approval.id)
                        .putExtra("approve", false),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
        }

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build())
        } catch (_: SecurityException) {
            // Notification permission is optional; the in-app approval card remains available.
        }
    }

    fun cancel(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }
}
