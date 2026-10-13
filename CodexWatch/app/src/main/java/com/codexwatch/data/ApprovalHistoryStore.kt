package com.codexwatch.data

import android.content.Context
import androidx.compose.runtime.Immutable
import org.json.JSONArray
import org.json.JSONObject

@Immutable
data class ApprovalHistoryEntry(
    val approvalId: String,
    val approvalTitle: String,
    val threadId: String,
    val threadTitle: String,
    val decision: String,
    val risk: String,
    val commandPreview: String?,
    val decidedAtMs: Long,
)

class ApprovalHistoryStore(context: Context) {
    private val prefs = context.getSharedPreferences("codex_approval_history", Context.MODE_PRIVATE)

    fun recent(limit: Int = 20): List<ApprovalHistoryEntry> {
        val raw = prefs.getString(KEY_HISTORY, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            val result = ArrayList<ApprovalHistoryEntry>(minOf(arr.length(), limit))
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                result.add(
                    ApprovalHistoryEntry(
                        approvalId = obj.optString("approvalId"),
                        approvalTitle = obj.optString("approvalTitle"),
                        threadId = obj.optString("threadId"),
                        threadTitle = obj.optString("threadTitle"),
                        decision = obj.optString("decision"),
                        risk = obj.optString("risk", "unknown"),
                        commandPreview = obj.optString("commandPreview").ifBlank { null },
                        decidedAtMs = obj.optLong("decidedAtMs"),
                    )
                )
            }
            result.sortedByDescending { it.decidedAtMs }.take(limit)
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun record(
        approval: ApprovalEntry,
        threadId: String,
        threadTitle: String,
        decision: String,
    ) {
        val old = try { JSONArray(prefs.getString(KEY_HISTORY, "[]")) } catch (_: Exception) { JSONArray() }
        val entry = JSONObject()
            .put("approvalId", approval.id)
            .put("approvalTitle", approval.title)
            .put("threadId", threadId)
            .put("threadTitle", threadTitle)
            .put("decision", decision)
            .put("risk", approval.risk)
            .put("commandPreview", approval.commandPreview ?: "")
            .put("decidedAtMs", System.currentTimeMillis())

        val next = JSONArray()
        next.put(entry)
        for (i in 0 until old.length()) {
            val value = old.optJSONObject(i) ?: continue
            if (value.optString("approvalId") == approval.id) continue
            next.put(value)
            if (next.length() >= MAX_ENTRIES) break
        }
        prefs.edit().putString(KEY_HISTORY, next.toString()).apply()
    }

    companion object {
        private const val KEY_HISTORY = "entries"
        private const val MAX_ENTRIES = 20
    }
}
