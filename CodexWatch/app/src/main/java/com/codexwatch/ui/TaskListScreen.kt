package com.codexwatch.ui

import android.text.format.DateUtils
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.codexwatch.data.ConnState
import com.codexwatch.data.approvalRiskLabel
import com.codexwatch.data.formatTokens
import com.codexwatch.ui.theme.AccentBlue
import com.codexwatch.ui.theme.CardBgWarm
import com.codexwatch.ui.theme.CardBorderWarm
import com.codexwatch.ui.theme.DangerRed
import com.codexwatch.ui.theme.MutedText
import com.codexwatch.ui.theme.NeutralStatus
import com.codexwatch.ui.theme.SuccessGreen
import com.codexwatch.ui.theme.WarnOrange

private val MarkdownLink = Regex("\\[[^\\]]+\\]\\([^\\)]+\\)")
private val Whitespace = Regex("\\s+")

fun phaseColor(phase: String): Color = when (phase) {
    "running" -> SuccessGreen
    "waiting_approval" -> WarnOrange
    "idle" -> NeutralStatus
    "aborted" -> DangerRed
    else -> NeutralStatus.copy(alpha = 0.65f)
}

fun phaseLabel(phase: String): String = when (phase) {
    "running" -> "运行中"
    "waiting_approval" -> "待审批"
    "idle" -> "空闲"
    "aborted" -> "已中断"
    else -> "未知"
}

fun approvalRiskColor(risk: String): Color = when (risk) {
    "low" -> SuccessGreen
    "medium" -> WarnOrange
    "high" -> DangerRed
    else -> NeutralStatus
}

fun displayTitle(raw: String): String {
    val compact = raw.replace(MarkdownLink, " ").replace(Whitespace, " ").trim()
    return compact.ifEmpty { raw.replace(Whitespace, " ").trim() }
}

@Composable
private fun HeaderStatus(
    text: String,
    color: Color,
    onPair: () -> Unit,
    onHistory: () -> Unit,
) {
    Column(Modifier.padding(horizontal = 20.dp)) {
        Text(
            text = "CODEX WATCH",
            style = MaterialTheme.typography.caption2,
            color = MutedText,
        )
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusDot(color)
            Spacer(Modifier.width(7.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.caption1,
                color = MaterialTheme.colors.onBackground,
            )
            Spacer(Modifier.weight(1f))
            Text(
                text = "历史",
                style = MaterialTheme.typography.caption1,
                color = AccentBlue,
                modifier = Modifier
                    .padding(6.dp)
                    .clickable(onClick = onHistory),
            )
            Text(
                text = "配对",
                style = MaterialTheme.typography.caption1,
                color = AccentBlue,
                modifier = Modifier
                    .padding(start = 2.dp, top = 6.dp, bottom = 6.dp, end = 2.dp)
                    .clickable(onClick = onPair),
            )
        }
    }
}

@Composable
fun TaskListScreen(
    ui: com.codexwatch.ui.UiState,
    vm: AppViewModel,
    onOpen: (String) -> Unit,
    onPair: () -> Unit,
    onHistory: () -> Unit,
) {
    val approvals = remember(ui.threads) { vm.allApprovals() }
    val history = vm.approvalHistory.value

    Box(modifier = Modifier.fillMaxWidth()) {
        TimeText()
        ScalingLazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(top = 48.dp, bottom = 26.dp),
        ) {
            item {
                HeaderStatus(
                    text = when (ui.conn) {
                        ConnState.CONNECTED -> "已连接"
                        ConnState.CONNECTING -> "连接中"
                        ConnState.AUTH_FAILED -> "认证失败"
                        ConnState.DISCONNECTED -> "离线"
                    },
                    color = when (ui.conn) {
                        ConnState.CONNECTED -> SuccessGreen
                        ConnState.CONNECTING -> WarnOrange
                        ConnState.AUTH_FAILED -> DangerRed
                        ConnState.DISCONNECTED -> NeutralStatus
                    },
                    onPair = onPair,
                    onHistory = onHistory,
                )
            }

            if (approvals.isNotEmpty()) {
                item { SectionLabel("待审批 · ${approvals.size}") }
                items(approvals.size, key = { approvals[it].second.id }) { idx ->
                    val (thread, approval) = approvals[idx]
                    val risk = approvalRiskColor(approval.risk)
                    val summary = approval.commandPreview
                        ?: approval.targetPath
                        ?: thread.cwd
                        ?: "点击处理"

                    CodexCard(
                        onClick = { onOpen(thread.id) },
                        backgroundColor = CardBgWarm,
                        borderColor = CardBorderWarm,
                        accent = risk,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TitleText(displayTitle(approval.title), modifier = Modifier.weight(1f))
                            StatusPill(approvalRiskLabel(approval.risk), risk)
                        }
                        Spacer(Modifier.height(3.dp))
                        MetaText(displayTitle(summary))
                        if (approval.requiresStrongConfirm) {
                            Spacer(Modifier.height(2.dp))
                            MetaText("高风险 · 需要强确认", color = DangerRed)
                        }
                    }
                }
            }

            item { SectionLabel("最近任务") }
            items(ui.threads.size, key = { ui.threads[it].id }) { idx ->
                val thread = ui.threads[idx]
                val compactTitle = remember(thread.title) { displayTitle(thread.title) }
                val phase = phaseColor(thread.phase)
                val relative = remember(thread.lastActivityMs) {
                    DateUtils.getRelativeTimeSpanString(
                        minOf(thread.lastActivityMs, System.currentTimeMillis()),
                        System.currentTimeMillis(),
                        DateUtils.MINUTE_IN_MILLIS,
                        DateUtils.FORMAT_ABBREV_RELATIVE,
                    ).toString()
                }

                CodexCard(
                    onClick = { onOpen(thread.id) },
                    accent = phase,
                ) {
                    TitleText(compactTitle, modifier = Modifier.padding(end = 6.dp))
                    Spacer(Modifier.height(4.dp))
                    MetaText("${phaseLabel(thread.phase)} · $relative · ${formatTokens(thread.tokensUsed)}")
                }
            }

            item { SectionLabel("审批历史 · ${history.size}") }
            if (history.isEmpty()) {
                item {
                    CodexCard {
                        MetaText("最近 20 次手表审批会显示在这里")
                    }
                }
            } else {
                items(history.size, key = { history[it].approvalId + history[it].decidedAtMs }) { idx ->
                    val item = history[idx]
                    val decisionColor = when (item.decision) {
                        "approve" -> SuccessGreen
                        "reject" -> DangerRed
                        else -> NeutralStatus
                    }
                    CodexCard(accent = decisionColor) {
                        TitleText(displayTitle(item.approvalTitle), modifier = Modifier.padding(end = 6.dp))
                        Spacer(Modifier.height(4.dp))
                        MetaText(
                            when (item.decision) {
                                "approve" -> "已批准"
                                "reject" -> "已拒绝"
                                else -> "已结束"
                            } + " · " + approvalRiskLabel(item.risk),
                            color = decisionColor,
                        )
                    }
                }
            }
        }
    }
}
