package com.codexwatch.ui

import android.text.format.DateFormat
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.codexwatch.ui.theme.MutedText
import com.codexwatch.ui.theme.PrimaryText
import java.util.Date

@Composable
fun QuickResultScreen(vm: AppViewModel) {
    val instruction = vm.ui.value.lastInstruction

    Box(modifier = Modifier.fillMaxWidth()) {
        TimeText()
        ScalingLazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(top = 48.dp, bottom = 28.dp),
        ) {
            if (instruction == null) {
                item {
                    Column(Modifier.padding(horizontal = 20.dp)) {
                        Text(
                            text = "暂无快捷指令结果",
                            style = MaterialTheme.typography.title3,
                            color = PrimaryText,
                        )
                        Text(
                            text = "请先从任务中控发送指令",
                            style = MaterialTheme.typography.caption1,
                            color = MutedText,
                        )
                    }
                }
            } else {
                item {
                    Column(Modifier.padding(horizontal = 20.dp)) {
                        Text(
                            text = "快捷指令结果",
                            style = MaterialTheme.typography.title3,
                            color = PrimaryText,
                        )
                        Spacer(Modifier.height(5.dp))
                        Text(
                            text = when (instruction.status) {
                                "queued" -> "等待投递"
                                "dispatched" -> "已投递 Codex"
                                "delivered" -> "Codex 已接收"
                                "completed" -> "Codex 已回应"
                                "failed" -> "Codex 失败"
                                "expired" -> "已过期"
                                else -> "处理中"
                            },
                            style = MaterialTheme.typography.caption1,
                            color = when (instruction.status) {
                                "completed" -> com.codexwatch.ui.theme.SuccessGreen
                                "failed", "expired" -> com.codexwatch.ui.theme.DangerRed
                                else -> com.codexwatch.ui.theme.WarnOrange
                            },
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "请求",
                            style = MaterialTheme.typography.caption2,
                            color = MutedText,
                        )
                        Text(
                            text = instruction.text,
                            style = MaterialTheme.typography.caption1,
                            color = PrimaryText,
                        )
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "回复",
                            style = MaterialTheme.typography.caption2,
                            color = MutedText,
                        )
                    }
                }

                item {
                    Text(
                        text = instruction.result ?: "Codex 尚未回传结果",
                        style = MaterialTheme.typography.caption1,
                        color = if (instruction.result.isNullOrBlank()) MutedText else PrimaryText,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 20.dp),
                    )
                }

                item {
                    Text(
                        text = "更新时间：" + DateFormat.getTimeFormat(vm.getApplication())
                            .format(Date(instruction.atMs)),
                        style = MaterialTheme.typography.caption2,
                        color = MutedText,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    )
                }
            }
        }
    }
}
