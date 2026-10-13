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
    val source: String,
    val action: String? = null,
    val targetPath: String? = null,
    val affectedFiles: List<String> = emptyList(),
    val commandPreview: String? = null,
    val reasons: List<String> = emptyList(),
    val reversible: Boolean? = null,
    val requiresStrongConfirm: Boolean = false,
    val metadata: Map<String, String> = emptyMap(),
)

@Immutable
data class TimelineEvent(
    val id: String,
    val tsMs: Long,
    val kind: String,
    val title: String,
    val detail: String?,
)

@Immutable
data class InstructionFeedback(
    val id: String,
    val threadId: String,
    val status: String,
    val text: String,
    val result: String?,
    val atMs: Long,
)

@Immutable
data class ControlFeedback(
    val threadId: String,
    val action: String,
    val accepted: Boolean,
    val supported: Boolean,
    val message: String,
    val atMs: Long,
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
    val timeline: List<TimelineEvent> = emptyList(),
)

fun parseApproval(a: JSONObject): ApprovalEntry {
    val files = mutableListOf<String>()
    a.optJSONArray("affectedFiles")?.let { arr ->
        for (i in 0 until arr.length()) {
            val value = arr.optString(i)
            if (value.isNotBlank()) files.add(value)
        }
    }

    val reasons = mutableListOf<String>()
    a.optJSONArray("reasons")?.let { arr ->
        for (i in 0 until arr.length()) {
            val value = arr.optString(i)
            if (value.isNotBlank()) reasons.add(value)
        }
    }

    val metadata = linkedMapOf<String, String>()
    a.optJSONObject("metadata")?.let { obj ->
        for (key in obj.keys()) {
            obj.opt(key)?.let { metadata[key] = it.toString() }
        }
    }

    return ApprovalEntry(
        id = a.optString("id"),
        title = a.optString("title", "Approval"),
        detail = a.optString("detail"),
        risk = a.optString("risk", "unknown"),
        createdAtMs = a.optLong("createdAtMs"),
        source = a.optString("source", "unknown"),
        action = a.optString("action").ifBlank { null },
        targetPath = a.optString("targetPath").ifBlank { null },
        affectedFiles = files,
        commandPreview = a.optString("commandPreview").ifBlank { null },
        reasons = reasons,
        reversible = if (a.has("reversible") && !a.isNull("reversible")) {
            a.optBoolean("reversible")
        } else {
            null
        },
        requiresStrongConfirm = a.optBoolean(
            "requiresStrongConfirm",
            a.optString("risk") == "high",
        ),
        metadata = metadata,
    )
}

fun parseTimelineEvent(o: JSONObject): TimelineEvent = TimelineEvent(
    id = o.optString("id"),
    tsMs = o.optLong("tsMs"),
    kind = o.optString("kind", "message"),
    title = o.optString("title"),
    detail = o.optString("detail").ifBlank { null },
)

fun parseThread(o: JSONObject): ThreadState {
    val arr = o.optJSONArray("pendingApprovals")
    val approvals = ArrayList<ApprovalEntry>(arr?.length() ?: 0)
    if (arr != null) {
        for (i in 0 until arr.length()) {
            arr.optJSONObject(i)?.let { approvals.add(parseApproval(it)) }
        }
    }

    val timeline = ArrayList<TimelineEvent>()
    o.optJSONArray("timeline")?.let { timelineArr ->
        for (i in 0 until timelineArr.length()) {
            timelineArr.optJSONObject(i)?.let { timeline.add(parseTimelineEvent(it)) }
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
        timeline = timeline,
    )
}

fun approvalRiskLabel(risk: String): String = when (risk) {
    "low" -> "低风险"
    "medium" -> "中风险"
    "high" -> "高风险"
    else -> "风险未知"
}

fun formatTokens(n: Long?): String {
    if (n == null) return "-"
    return when {
        n >= 1_000_000 -> String.format("%.1fM", n / 1_000_000.0)
        n >= 1_000 -> String.format("%.1fk", n / 1_000.0)
        else -> n.toString()
    }
}
