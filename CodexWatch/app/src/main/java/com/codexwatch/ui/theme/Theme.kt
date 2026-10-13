package com.codexwatch.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme

// ---- Codex Watch design tokens ----
// A restrained dark system: near-black surfaces, one cool accent, and precise status colors.
val PageBg = Color(0xFF070A0D)
val PageBgDeep = Color(0xFF030507)
val CardBg = Color(0xFF10161C)
val CardBgWarm = Color(0xFF181410)
val CardBorder = Color(0xFF1E2731)
val CardBorderWarm = Color(0xFF372B1F)
val MutedText = Color(0xFF8C9BA8)
val SubtleText = Color(0xFF64727E)
val PrimaryText = Color(0xFFF1F5F7)
val AccentBlue = Color(0xFF7AA7FF)
val AccentSoft = Color(0x147AA7FF)
val SuccessGreen = Color(0xFF69C58C)
val SuccessSoft = Color(0x1469C58C)
val WarnOrange = Color(0xFFE0A952)
val WarnSoft = Color(0x16E0A952)
val DangerRed = Color(0xFFE87A7A)
val DangerSoft = Color(0x16E87A7A)
val NeutralStatus = Color(0xFF7C8894)

@Composable
fun CodexWatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colors = Colors(
            background = PageBg,
            onBackground = PrimaryText,
            surface = CardBg,
            onSurface = PrimaryText,
            primary = AccentBlue,
            onPrimary = Color(0xFF06090C),
            secondary = Color(0xFF1A222B),
            onSecondary = PrimaryText,
            error = DangerRed,
            onError = Color(0xFF06090C),
        ),
        content = content,
    )
}
