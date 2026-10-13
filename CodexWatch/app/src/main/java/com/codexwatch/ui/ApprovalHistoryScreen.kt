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
fun ApprovalHistoryScreen(vm: AppViewModel) {
    val history = vm.approvalHistory.value

    Box(modifier = Modifier.fillMaxWidth()) {
        TimeText()
        ScalingLazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(top = 48.dp, bottom = 26.dp),
        ) {
            item {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Text(
                        text = "审批历史",
                        style = MaterialTheme.typography.title3,
                        color = PrimaryText,
                    )
                    Text(
                        text = "最近 20 次手表操作",
                        style = MaterialTheme.typography.caption2,
                        color = MutedText,
                    )
                }
            }

            if (history.isEmpty()) {
                item {
                    CodexCard {
                        MetaText("还没有从手表完成审批")
                    }
                }
            } else {
                items(history.size, key = { history[it].approvalId + history[it].decidedAtMs }) { idx ->
                    val item = history[idx]
                    val decisionColor = approvalRiskColor(item.decision)
                    CodexCard(accent = decisionColor) {
                        TitleText(displayTitle(item.approvalTitle), modifier = Modifier.padding(end = 6.dp), maxLines = 2)
                        Spacer(Modifier.height(4.dp))
                        MetaText(
                            when (item.decision) {
                                "approve" -> "已批准"
                                "reject" -> "已拒绝"
                                else -> "已结束"
                            } + " · " + DateFormat.getTimeFormat(vm.getApplication()).format(Date(item.decidedAtMs)),
                            color = decisionColor,
                        )
                        item.commandPreview?.let {
                            Spacer(Modifier.height(3.dp))
                            MetaText(displayTitle(it))
                        }
                    }
                }
            }
        }
    }
}
