package com.codexwatch.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import com.codexwatch.data.ConnState
import com.codexwatch.ui.theme.AccentBlue
import com.codexwatch.ui.theme.CardBorder
import com.codexwatch.ui.theme.MutedText
import com.codexwatch.ui.theme.PrimaryText

@Composable
fun PairingScreen(ui: UiState, vm: AppViewModel, onConnected: () -> Unit) {
    val discovered by vm.discovered
    val searching by vm.searching

    LaunchedEffect(Unit) {
        vm.udpDiscover()
        vm.startDiscovery()
    }

    Box(modifier = Modifier.fillMaxWidth()) {
        TimeText()
        ScalingLazyColumn(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(top = 48.dp, bottom = 26.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    Text(
                        text = "CODEX WATCH",
                        style = MaterialTheme.typography.caption2,
                        color = MutedText,
                    )
                    Spacer(Modifier.height(3.dp))
                    Text(
                        text = "连接电脑端",
                        style = MaterialTheme.typography.title3,
                        color = PrimaryText,
                    )
                }
            }
            item {
                Text(
                    text = if (searching) "正在搜索电脑端服务" else if (discovered.isEmpty()) "未发现，可手动输入" else "已发现 ${discovered.size} 个服务",
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.caption1,
                    color = MutedText,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                )
            }
            item {
                Chip(
                    onClick = {
                        vm.udpDiscover()
                        vm.startDiscovery()
                    },
                    label = { Text("重新搜索") },
                    colors = ChipDefaults.secondaryChipColors(
                        backgroundColor = MaterialTheme.colors.secondary,
                        contentColor = MaterialTheme.colors.onPrimary,
                    ),
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            if (discovered.isNotEmpty()) {
                item { SectionLabel("发现的服务") }
                items(discovered.size) { idx ->
                    val entry = discovered[idx]
                    CodexCard(onClick = {
                        vm.setHost(entry)
                        onConnected()
                    }) {
                        TitleText(entry, maxLines = 1)
                        Spacer(Modifier.height(3.dp))
                        MetaText("选择后进入任务列表")
                    }
                }
            }

            item { SectionLabel("手动配对") }
            item {
                OutlinedTextField(
                    value = ui.host,
                    onValueChange = vm::setHost,
                    singleLine = true,
                    label = { Text("PC地址 host:port") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = PrimaryText,
                        unfocusedTextColor = PrimaryText,
                        focusedBorderColor = AccentBlue,
                        unfocusedBorderColor = CardBorder,
                        focusedLabelColor = AccentBlue,
                        unfocusedLabelColor = MutedText,
                        cursorColor = AccentBlue,
                    ),
                    modifier = Modifier
                        .fillMaxWidth(0.92f)
                        .padding(bottom = 2.dp),
                )
            }
            item {
                OutlinedTextField(
                    value = ui.pin,
                    onValueChange = vm::setPin,
                    singleLine = true,
                    label = { Text("PIN（6位）") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = PrimaryText,
                        unfocusedTextColor = PrimaryText,
                        focusedBorderColor = AccentBlue,
                        unfocusedBorderColor = CardBorder,
                        focusedLabelColor = AccentBlue,
                        unfocusedLabelColor = MutedText,
                        cursorColor = AccentBlue,
                    ),
                    modifier = Modifier.fillMaxWidth(0.92f),
                )
            }
            item {
                Chip(
                    onClick = {
                        vm.pairWithPin(ui.host, ui.pin) { ok, _ ->
                            if (ok) onConnected()
                        }
                    },
                    label = { Text("PIN 配对") },
                    colors = ChipDefaults.primaryChipColors(
                        backgroundColor = AccentBlue,
                        contentColor = MaterialTheme.colors.onPrimary,
                    ),
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            item {
                Text(
                    text = when (ui.conn) {
                        ConnState.CONNECTED -> "已连接"
                        ConnState.CONNECTING -> "连接中..."
                        ConnState.AUTH_FAILED -> "认证失败，检查 token"
                        ConnState.DISCONNECTED -> "未连接"
                    },
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.caption1,
                    color = MutedText,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                )
            }
            item {
                Text(
                    text = "PIN 在电脑端启动窗口查看；手表与电脑需在同一 Wi-Fi",
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.caption2,
                    color = MutedText,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 18.dp, vertical = 6.dp),
                )
            }
        }
    }
}
