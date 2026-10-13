package com.codexwatch.ui

import android.text.format.DateFormat
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.codexwatch.data.formatTokens
import com.codexwatch.ui.theme.MutedText
import com.codexwatch.ui.theme.WarnOrange
import java.util.Date

@Composable
private fun InfoRow(label: String, value: String, maxLines: Int = 1) {
    Row(Modifier.fillMaxWidth().padding(vertical = 1.dp)) {
        Text(
            text = label,
            style = MaterialTheme.typography.caption2,
            color = MutedText,
            modifier = Modifier.width(52.dp),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.caption1,
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun TaskDetailScreen(ui: UiState, vm: AppViewModel, threadId: String) {
    val thread = ui.threads.firstOrNull { it.id == threadId }
    Box(modifier = Modifier.fillMaxWidth()) {
        TimeText()
        ScalingLazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(top = 46.dp, bottom = 30.dp),
        ) {
            if (thread == null) {
                item { ListHeader { Text("任务不存在或已刷新") } }
            } else {
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StatusDot(phaseColor(thread.phase))
                            Spacer(Modifier.width(8.dp))
                            Text(
                                text = phaseLabel(thread.phase),
                                style = MaterialTheme.typography.title3,
                                color = phaseColor(thread.phase),
                            )
                        }
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = thread.title.replace(Regex("\\s+"), " "),
                            style = MaterialTheme.typography.title2,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                item {
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                        InfoRow("活跃", DateFormat.getTimeFormat(vm.getApplication()).format(Date(thread.lastActivityMs)))
                        InfoRow("Token", formatTokens(thread.tokensUsed))
                        if (!thread.model.isNullOrEmpty()) InfoRow("模型", thread.model!!)
                        if (!thread.approvalPolicy.isNullOrEmpty()) InfoRow("审批", thread.approvalPolicy!!)
                        if (!thread.cwd.isNullOrEmpty()) InfoRow("目录", thread.cwd!!, 2)
                    }
                }
                if (!thread.lastEvent.isNullOrEmpty()) {
                    item {
                        Card(onClick = {}, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
                            Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
                                Text("最近动态", style = MaterialTheme.typography.caption2, color = MutedText)
                                Text(
                                    text = thread.lastEvent!!,
                                    style = MaterialTheme.typography.caption1,
                                    maxLines = 4,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
                for (approval in thread.pendingApprovals) {
                    item {
                        Card(onClick = {}, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp)) {
                            Column(Modifier.padding(10.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    StatusDot(WarnOrange)
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        text = "审批 · 风险 ${approval.risk}",
                                        style = MaterialTheme.typography.caption1,
                                        color = WarnOrange,
                                    )
                                }
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    text = approval.title,
                                    style = MaterialTheme.typography.title3,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = approval.detail,
                                    style = MaterialTheme.typography.caption1,
                                    maxLines = 8,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    item {
                        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
                            Chip(
                                onClick = { vm.decide(approval.id, true) },
                                label = { Text("批准", maxLines = 1) },
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = Color(0xFF1F5B3A),
                                    contentColor = Color.White,
                                ),
                                modifier = Modifier.weight(1f),
                            )
                            Spacer(Modifier.width(8.dp))
                            Chip(
                                onClick = { vm.decide(approval.id, false) },
                                label = { Text("拒绝", maxLines = 1) },
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = Color(0xFF7A2E2E),
                                    contentColor = Color.White,
                                ),
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }
            }
        }
    }
}
