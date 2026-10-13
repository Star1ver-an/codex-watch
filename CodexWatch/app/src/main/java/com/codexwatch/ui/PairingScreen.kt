package com.codexwatch.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.material3.OutlinedTextField
import com.codexwatch.data.ConnState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.ScalingLazyColumn
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText

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
            contentPadding = PaddingValues(top = 46.dp, bottom = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item { ListHeader { Text("Codex Watch Bridge") } }
            item {
                Text(
                    text = if (searching) "正在搜索电脑端服务..." else if (discovered.isEmpty()) "未发现,可手动输入" else "已发现 " + discovered.size + " 个服务",
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
            }
            item {
                Chip(
                    onClick = { vm.udpDiscover(); vm.startDiscovery() },
                    label = { Text("重新搜索") },
                    colors = ChipDefaults.secondaryChipColors(),
                )
            }

            if (discovered.isNotEmpty()) {
                item { ListHeader { Text("发现的服务") } }
                items(discovered.size) { idx ->
                    val entry = discovered[idx]
                    Chip(
                        onClick = {
                            vm.setHost(entry)
                            onConnected()
                        },
                        label = { Text(entry, maxLines = 1) },
                        colors = ChipDefaults.primaryChipColors(),
                    )
                }
            }

            item { ListHeader { Text("手动配对") } }
            item {
                OutlinedTextField(
                    value = ui.host,
                    onValueChange = vm::setHost,
                    singleLine = true,
                    label = { Text("PC地址 host:port") },
                    modifier = Modifier.fillMaxWidth(0.92f),
                )
            }
            item {
                OutlinedTextField(
                    value = ui.pin,
                    onValueChange = vm::setPin,
                    singleLine = true,
                    label = { Text("PIN (6位)") },
                    modifier = Modifier.fillMaxWidth(0.92f),
                )
            }
            item {
                Chip(
                    onClick = {
                        vm.pairWithPin(ui.host, ui.pin) { ok, msg ->
                            if (ok) onConnected()
                        }
                    },
                    label = { Text("PIN 配对") },
                    colors = ChipDefaults.primaryChipColors(),
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            item {
                Text(
                    text = when (ui.conn) {
                        ConnState.CONNECTED -> "已连接"
                        ConnState.CONNECTING -> "连接中..."
                        ConnState.AUTH_FAILED -> "认证失败,检查 token"
                        ConnState.DISCONNECTED -> "未连接"
                    },
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                Text(
                    text = "PIN 在电脑端 start-bridge 启动窗口查看(每次重启刷新);与电脑需同一 Wi-Fi",
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(8.dp),
                )
            }
        }
    }
}
