@file:OptIn(ExperimentalFoundationApi::class)
package com.codexwatch.ui

import android.text.format.DateFormat
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.codexwatch.data.ApprovalEntry
import com.codexwatch.data.ControlFeedback
import com.codexwatch.data.InstructionFeedback
import com.codexwatch.data.TimelineEvent
import com.codexwatch.data.approvalRiskLabel
import com.codexwatch.data.formatTokens
import com.codexwatch.ui.theme.AccentBlue
import com.codexwatch.ui.theme.CardBgWarm
import com.codexwatch.ui.theme.CardBorderWarm
import com.codexwatch.ui.theme.DangerRed
import com.codexwatch.ui.theme.MutedText
import com.codexwatch.ui.theme.PrimaryText
import com.codexwatch.ui.theme.SuccessGreen
import com.codexwatch.ui.theme.WarnOrange
import java.util.Date

private val ActionShape = RoundedCornerShape(18.dp)

@Composable
private fun InfoRow(label: String, value: String, valueColor: Color = PrimaryText, maxLines: Int = 3) {
    Row(
        verticalAlignment = Alignment.Top,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.caption2,
            color = MutedText,
            modifier = Modifier.width(58.dp),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.caption1,
            color = valueColor,
            maxLines = maxLines,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun DetailHeader(phase: String, title: String) {
    val color = phaseColor(phase)
    Column(Modifier.padding(horizontal = 20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            StatusDot(color)
            Spacer(Modifier.width(7.dp))
            Text(
                text = phaseLabel(phase),
                style = MaterialTheme.typography.caption1,
                color = color,
            )
        }
        Spacer(Modifier.height(7.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.title2,
            color = PrimaryText,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun TimelineCard(events: List<TimelineEvent>) {
    CodexCard {
        MetaText("最近时间线")
        Spacer(Modifier.height(6.dp))
        if (events.isEmpty()) {
            MetaText("暂无结构化事件")
        } else {
            events.take(8).forEachIndexed { index, event ->
                if (index > 0) Spacer(Modifier.height(7.dp))
                Row(verticalAlignment = Alignment.Top) {
                    Box(
                        modifier = Modifier
                            .padding(top = 5.dp)
                            .width(3.dp)
                            .height(28.dp)
                            .background(timelineColor(event.kind), RoundedCornerShape(2.dp)),
                    )
                    Spacer(Modifier.width(9.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = event.title,
                            style = MaterialTheme.typography.caption1,
                            color = PrimaryText,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text = DateFormat.getTimeFormat(androidx.compose.ui.platform.LocalContext.current)
                                .format(Date(event.tsMs)),
                            style = MaterialTheme.typography.caption2,
                            color = MutedText,
                        )
                        event.detail?.let {
                            Text(
                                text = displayTitle(it),
                                style = MaterialTheme.typography.caption2,
                                color = MutedText,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun timelineColor(kind: String): Color = when (kind) {
    "started" -> SuccessGreen
    "completed" -> SuccessGreen
    "aborted" -> DangerRed
    "approval_requested" -> WarnOrange
    "approval_resolved" -> SuccessGreen
    "control_requested" -> WarnOrange
    "message" -> androidx.compose.ui.graphics.Color(0xFF7AA7FF)
    "warning" -> DangerRed
    else -> MutedText
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ControlButton(
    title: String,
    color: Color,
    strongConfirm: Boolean = false,
    onClick: () -> Unit,
) {
    var armed by remember(title) { mutableStateOf(false) }
    LaunchedEffect(title, armed) {
        if (armed) {
            kotlinx.coroutines.delay(3500)
            armed = false
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 10.dp, vertical = 3.dp)
            .height(46.dp)
            .clip(ActionShape)
            .background(color.copy(alpha = 0.14f))
            .combinedClickable(
                onClick = {
                    if (strongConfirm && !armed) armed = true else onClick()
                },
            ),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(
            text = if (strongConfirm && armed) "再次点击确认" else title,
            style = MaterialTheme.typography.caption1,
            color = color,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 14.dp),
        )
    }
}

@Composable
private fun ControlCenter(
    threadId: String,
    phase: String,
    hasPendingApproval: Boolean,
    feedback: ControlFeedback?,
    instruction: InstructionFeedback?,
    onControl: (String, String?) -> Unit,
    onMessage: (String) -> Unit,
    onOpenResult: () -> Unit,
) {
    CodexCard {
        MetaText("任务中控")
        Spacer(Modifier.height(7.dp))

        feedback?.let {
            InfoRow(
                label = if (it.accepted) "已执行" else if (it.supported) "未执行" else "已记录",
                value = it.message,
                valueColor = if (it.accepted) SuccessGreen else WarnOrange,
                maxLines = 3,
            )
            Spacer(Modifier.height(7.dp))
        }

        instruction?.takeIf { it.text.isNotBlank() }?.let { item ->
            val label = when (item.status) {
                "queued" -> "等待投递"
                "dispatched" -> "已投递 Codex"
                "delivered" -> "Codex 已接收"
                "completed" -> "Codex 已回应"
                "failed" -> "Codex 失败"
                "expired" -> "已过期"
                else -> "快捷指令"
            }
            val color = when (item.status) {
                "queued" -> WarnOrange
                "dispatched", "delivered" -> AccentBlue
                "completed" -> SuccessGreen
                "failed", "expired" -> DangerRed
                else -> MutedText
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(ActionShape)
                    .background(MaterialTheme.colors.secondary)
                    .combinedClickable(onClick = onOpenResult)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = label,
                            style = MaterialTheme.typography.caption2,
                            color = color,
                        )
                        Spacer(Modifier.weight(1f))
                        Text(
                            text = "查看全部",
                            style = MaterialTheme.typography.caption2,
                            color = AccentBlue,
                        )
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(
                        text = item.result ?: item.text,
                        style = MaterialTheme.typography.caption1,
                        color = PrimaryText,
                        maxLines = if (item.result.isNullOrBlank()) 2 else 5,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Spacer(Modifier.height(7.dp))
        }

        when (phase) {
            "running" -> {
                ControlButton("请求暂停", WarnOrange) { onControl("pause", "watch task pause") }
                ControlButton("请求停止", DangerRed, strongConfirm = true) { onControl("stop", "watch task stop") }
            }
            "waiting_approval" -> {
                if (hasPendingApproval) {
                    ControlButton("取消当前审批", WarnOrange) { onControl("cancel_approval", "watch task cancel") }
                }
            }
            "aborted" -> ControlButton("请求重试", AccentButtonColor(), strongConfirm = true) { onControl("retry", "watch task retry") }
            "idle" -> ControlButton("请求重试", AccentButtonColor(), strongConfirm = true) { onControl("retry", "watch task retry") }
        }

        Spacer(Modifier.height(6.dp))
        MetaText("快捷指令 · 保存到本地收件箱")
        listOf(
            "输出当前进展摘要",
            "只分析问题，不要修改代码",
            "先停下来，等我回来",
        ).forEach { message ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 2.dp)
                    .height(42.dp)
                    .clip(ActionShape)
                    .background(MaterialTheme.colors.secondary)
                    .combinedClickable(onClick = { onMessage(message) }),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(
                    text = message,
                    style = MaterialTheme.typography.caption1,
                    color = PrimaryText,
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 14.dp),
                )
            }
        }

        Text(
            text = "远程停止 / 重试受 Codex 桌面能力限制，当前只记录意图并审计。",
            style = MaterialTheme.typography.caption2,
            color = MutedText,
            modifier = Modifier.padding(start = 2.dp, top = 8.dp),
        )
    }
}

private fun AccentButtonColor(): Color = Color(0xFF7AA7FF)

@Composable
private fun ApprovalCard(approval: ApprovalEntry, threadCwd: String?) {
    val riskColor = approvalRiskColor(approval.risk)

    CodexCard(
        backgroundColor = CardBgWarm,
        borderColor = CardBorderWarm,
        accent = riskColor,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TitleText(displayTitle(approval.title), modifier = Modifier.weight(1f), maxLines = 2)
            StatusPill(approvalRiskLabel(approval.risk), riskColor)
        }

        approval.action?.let {
            Spacer(Modifier.height(5.dp))
            InfoRow("动作", displayTitle(it))
        }
        approval.commandPreview?.let {
            Spacer(Modifier.height(5.dp))
            InfoRow("命令", it)
        }
        val target = approval.targetPath ?: threadCwd
        target?.let {
            Spacer(Modifier.height(5.dp))
            InfoRow("目录", it, MutedText)
        }
        if (approval.affectedFiles.isNotEmpty()) {
            Spacer(Modifier.height(5.dp))
            InfoRow("文件", approval.affectedFiles.take(3).joinToString("\n") { it }, MutedText)
            if (approval.affectedFiles.size > 3) {
                Text(
                    text = "另有 ${approval.affectedFiles.size - 3} 个文件",
                    style = MaterialTheme.typography.caption2,
                    color = MutedText,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
        approval.reasons.forEach { reason ->
            Spacer(Modifier.height(5.dp))
            InfoRow("原因", reason, WarnOrange)
        }
        approval.reversible?.let {
            Spacer(Modifier.height(5.dp))
            InfoRow(
                "恢复",
                if (it) "可逆" else "不可逆",
                if (it) MutedText else DangerRed,
            )
        }

        Spacer(Modifier.height(6.dp))
        Text(
            text = approval.detail,
            style = MaterialTheme.typography.caption1,
            color = MutedText,
            maxLines = 6,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ApprovalActions(
    approval: ApprovalEntry,
    onDecision: (approve: Boolean, note: String?) -> Unit,
) {
    var armed by remember(approval.id) { mutableStateOf(false) }

    LaunchedEffect(approval.id, armed) {
        if (armed) {
            kotlinx.coroutines.delay(4000)
            armed = false
        }
    }

    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp)) {
            if (approval.requiresStrongConfirm) {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(ActionShape)
                        .background(DangerRed.copy(alpha = 0.16f))
                        .combinedClickable(
                            onClick = { armed = true },
                            onLongClick = { onDecision(true, null) },
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = if (armed) "长按批准" else "强确认",
                        style = MaterialTheme.typography.caption1,
                        color = DangerRed,
                        maxLines = 1,
                    )
                }
            } else {
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(52.dp)
                        .clip(ActionShape)
                        .background(SuccessGreen.copy(alpha = 0.16f))
                        .combinedClickable(onClick = { onDecision(true, null) }),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "批准",
                        style = MaterialTheme.typography.caption1,
                        color = SuccessGreen,
                        maxLines = 1,
                    )
                }
            }

            Spacer(Modifier.width(8.dp))
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(52.dp)
                    .clip(ActionShape)
                    .background(DangerRed.copy(alpha = 0.14f))
                    .combinedClickable(onClick = { onDecision(false, null) }),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "拒绝",
                    style = MaterialTheme.typography.caption1,
                    color = DangerRed,
                    maxLines = 1,
                )
            }
        }

        if (approval.requiresStrongConfirm) {
            Text(
                text = if (armed) "长按绿色区域完成批准" else "高风险操作，禁止一键批准",
                style = MaterialTheme.typography.caption2,
                color = if (armed) WarnOrange else MutedText,
                modifier = Modifier.padding(start = 12.dp, top = 5.dp),
            )
        }

        Text(
            text = "快捷拒绝原因",
            style = MaterialTheme.typography.caption2,
            color = MutedText,
            modifier = Modifier.padding(start = 12.dp, top = 10.dp, bottom = 4.dp),
        )
        listOf("太危险", "先不要执行", "等我看一下", "影响范围太大").forEach { reason ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 3.dp)
                    .height(44.dp)
                    .clip(ActionShape)
                    .background(MaterialTheme.colors.secondary)
                    .combinedClickable(onClick = { onDecision(false, reason) }),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text(
                    text = reason,
                    style = MaterialTheme.typography.caption1,
                    color = PrimaryText,
                    maxLines = 1,
                    modifier = Modifier.padding(horizontal = 14.dp),
                )
            }
        }
    }
}

@Composable
fun TaskDetailScreen(
    ui: UiState,
    vm: AppViewModel,
    threadId: String,
    onOpenResult: () -> Unit = {},
) {
    val thread = ui.threads.firstOrNull { it.id == threadId }

    Box(modifier = Modifier.fillMaxWidth()) {
        TimeText()
        ScalingLazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(top = 48.dp, bottom = 26.dp),
        ) {
            if (thread == null) {
                item {
                    Column(Modifier.padding(horizontal = 20.dp)) {
                        Text(
                            text = "任务不存在",
                            style = MaterialTheme.typography.title3,
                            color = PrimaryText,
                        )
                        Text(
                            text = "请返回后重新选择",
                            style = MaterialTheme.typography.caption1,
                            color = MutedText,
                        )
                    }
                }
            } else {
                item {
                    val compactTitle = remember(thread.title) { displayTitle(thread.title) }
                    DetailHeader(thread.phase, compactTitle)
                }

                item {
                    CodexCard {
                        InfoRow(
                            "活跃",
                            DateFormat.getTimeFormat(androidx.compose.ui.platform.LocalContext.current).format(Date(thread.lastActivityMs)),
                        )
                        InfoRow("Token", formatTokens(thread.tokensUsed))
                        thread.model?.let { InfoRow("模型", it) }
                        thread.approvalPolicy?.let { InfoRow("审批", it) }
                        thread.cwd?.let { InfoRow("目录", it, MutedText) }
                    }
                }

                item {
                    ControlCenter(
                        threadId = thread.id,
                        phase = thread.phase,
                        hasPendingApproval = thread.pendingApprovals.isNotEmpty(),
                        feedback = ui.lastControl?.takeIf { it.threadId == thread.id },
                        instruction = ui.lastInstruction?.takeIf { it.threadId == thread.id },
                        onControl = { action, reason -> vm.sendTaskControl(thread.id, action, reason) },
                        onMessage = { vm.sendThreadMessage(thread.id, it) },
                        onOpenResult = onOpenResult,
                    )
                }

                if (!thread.lastEvent.isNullOrEmpty()) {
                    item {
                        CodexCard {
                            MetaText("最近动态")
                            Spacer(Modifier.height(4.dp))
                            Text(
                                text = thread.lastEvent!!,
                                style = MaterialTheme.typography.caption1,
                                color = PrimaryText,
                                maxLines = 4,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }

                item {
                    TimelineCard(thread.timeline)
                }

                if (thread.pendingApprovals.isNotEmpty()) {
                    item { SectionLabel("待审批 · ${thread.pendingApprovals.size}") }
                    for (approval in thread.pendingApprovals) {
                        item(key = approval.id) {
                            ApprovalCard(approval, thread.cwd)
                        }
                        item(key = approval.id + "-actions") {
                            ApprovalActions(approval) { approve, note ->
                                vm.decide(approval.id, approve, note)
                            }
                        }
                    }
                }
            }
        }
    }
}
