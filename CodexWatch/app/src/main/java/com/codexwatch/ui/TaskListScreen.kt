package com.codexwatch.ui

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.codexwatch.data.ConnState
import com.codexwatch.data.ThreadState
import com.codexwatch.data.formatTokens
import com.codexwatch.ui.theme.AccentBlue
import com.codexwatch.ui.theme.CardBgWarm
import com.codexwatch.ui.theme.DangerRed
import com.codexwatch.ui.theme.MutedText
import com.codexwatch.ui.theme.SuccessGreen
import com.codexwatch.ui.theme.WarnOrange

private val whitespaceRegex = Regex("\\s+")

fun phaseColor(phase: String): Color = when (phase) {
    "running" -> SuccessGreen
    "waiting_approval" -> WarnOrange
    "idle" -> Color(0xFF8A93A1)
    "aborted" -> DangerRed
    else -> Color(0xFF5A6270)
}

fun phaseLabel(phase: String): String = when (phase) {
    "running" -> "运行中"
    "waiting_approval" -> "待审批"
    "idle" -> "空闲"
    "aborted" -> "已中断"
    else -> "未知"
}

@Composable
fun StatusDot(color: Color, sizeDp: Int = 8) {
    Box(
        modifier = Modifier
            .size(sizeDp.dp)
            .background(color, CircleShape)
    )
}

@Composable
fun SectionLabel(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.caption2,
        color = MutedText,
        modifier = Modifier.padding(start = 18.dp, top = 6.dp, bottom = 2.dp),
    )
}

@Composable
fun TaskListScreen(
    ui: UiState,
    vm: AppViewModel,
    onOpen: (String) -> Unit,
    onPair: () -> Unit,
) {
    val approvals = remember(ui.threads) { vm.allApprovals() }
    Box(modifier = Modifier.fillMaxWidth()) {
        TimeText()
        ScalingLazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(top = 46.dp, bottom = 30.dp),
        ) {
            item {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 4.dp),
                ) {
                    StatusDot(
                        when (ui.conn) {
                            ConnState.CONNECTED -> SuccessGreen
                            ConnState.CONNECTING -> WarnOrange
                            ConnState.AUTH_FAILED -> DangerRed
                            ConnState.DISCONNECTED -> Color(0xFF5A6270)
                        },
                        7
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(
                        text = when (ui.conn) {
                            ConnState.CONNECTED -> "已连接"
                            ConnState.CONNECTING -> "连接中..."
                            ConnState.AUTH_FAILED -> "认证失败"
                            ConnState.DISCONNECTED -> "离线"
                        },
                        style = MaterialTheme.typography.caption1,
                    )
                    Spacer(Modifier.weight(1f))
                    Text(
                        text = "配对",
                        style = MaterialTheme.typography.caption1,
                        color = AccentBlue,
                        modifier = Modifier
                            .padding(4.dp)
                            .clickable(onClick = onPair),
                    )
                }
            }

            if (approvals.isNotEmpty()) {
                item { SectionLabel("待审批 · ${approvals.size}") }
                items(approvals.size, key = { idx -> approvals[idx].second.id }) { idx ->
                    val (thread, approval) = approvals[idx]
                    Card(
                        onClick = { onOpen(thread.id) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 8.dp, vertical = 3.dp),
                    ) {
                        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                StatusDot(WarnOrange)
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = approval.title,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    style = MaterialTheme.typography.title3,
                                )
                            }
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = "风险:${approval.risk} · 点击处理",
                                style = MaterialTheme.typography.caption2,
                                color = MutedText,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }

            item { SectionLabel("最近任务") }
            items(ui.threads.size, key = { idx -> ui.threads[idx].id }) { idx ->
                val t = ui.threads[idx]
                val compactTitle = remember(t.title) { t.title.replace(whitespaceRegex, " ") }
                Card(
                    onClick = { onOpen(t.id) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                ) {
                    Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StatusDot(phaseColor(t.phase))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                text = compactTitle,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.title3,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        Spacer(Modifier.height(2.dp))
                        Text(
                            text = phaseLabel(t.phase) + " · " +
                                DateUtils.getRelativeTimeSpanString(
                                    t.lastActivityMs,
                                    System.currentTimeMillis(),
                                    DateUtils.MINUTE_IN_MILLIS,
                                    DateUtils.FORMAT_ABBREV_RELATIVE,
                                ).toString() +
                                " · " + formatTokens(t.tokensUsed),
                            style = MaterialTheme.typography.caption2,
                            color = MutedText,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

