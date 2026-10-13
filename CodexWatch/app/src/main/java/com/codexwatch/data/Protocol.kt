package com.codexwatch.data

import androidx.compose.runtime.Immutable
import org.json.JSONObject

enum class ConnState { DISCONNECTED, CONNECTING, CONNECTED, AUTH_FAILED }

@Immutable
data class ApprovalEntry(
    val id: String,
    val title: String,
    val detail: String,
    val risk: String,
    val createdAtMs: Long,
)

@Immutable
data class ThreadState(
    val id: String,
    val title: String,
    val phase: String,
    val lastActivityMs: Long,
    val tokensUsed: Long?,
    val lastEvent: String?,
    val cwd: String?,
    val model: String?,
    val approvalPolicy: String?,
    val pendingApprovals: List<ApprovalEntry>,
)

fun parseThread(o: JSONObject): ThreadState {
    val approvals = mutableListOf<ApprovalEntry>()
    val arr = o.optJSONArray("pendingApprovals")
    if (arr != null) {
        for (i in 0 until arr.length()) {
            val a = arr.getJSONObject(i)
            approvals.add(
                ApprovalEntry(
                    id = a.optString("id"),
                    title = a.optString("title"),
                    detail = a.optString("detail"),
                    risk = a.optString("risk", "unknown"),
                    createdAtMs = a.optLong("createdAtMs"),
                )
            )
        }
    }
    return ThreadState(
        id = o.optString("id"),
        title = o.optString("title", "Untitled"),
        phase = o.optString("phase", "unknown"),
        lastActivityMs = o.optLong("lastActivityMs"),
        tokensUsed = if (o.has("tokensUsed") && !o.isNull("tokensUsed")) o.optLong("tokensUsed") else null,
        lastEvent = o.optString("lastEvent").ifEmpty { null },
        cwd = o.optString("cwd").ifEmpty { null },
        model = o.optString("model").ifEmpty { null },
        approvalPolicy = o.optString("approvalPolicy").ifEmpty { null },
        pendingApprovals = approvals,
    )
}

fun formatTokens(n: Long?): String {
    if (n == null) return "-"
    return when {
        n >= 1_000_000 -> String.format("%.1fM", n / 1_000_000.0)
        n >= 1_000 -> String.format("%.1fk", n / 1_000.0)
        else -> n.toString()
    }
}
