package com.codexwatch.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme

// ---- 设计系统色板 ----
val AccentBlue = Color(0xFF5B8DEF)
val SuccessGreen = Color(0xFF34C77B)
val WarnOrange = Color(0xFFFFA640)
val DangerRed = Color(0xFFFF5C5C)
val CardBg = Color(0xFF15171C)
val CardBgWarm = Color(0xFF2A2118)   // 审批卡片暖底
val MutedText = Color(0xFF98A2B3)
val PageBg = Color(0xFF0B0D10)

@Composable
fun CodexWatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            background = PageBg,
            onBackground = Color(0xFFE8EAED),
            surface = CardBg,
            onSurface = Color(0xFFE8EAED),
            primary = AccentBlue,
            onPrimary = Color.White,
            secondary = Color(0xFF2A2F3A),
            onSecondary = Color.White,
        ),
        content = content,
    )
}
