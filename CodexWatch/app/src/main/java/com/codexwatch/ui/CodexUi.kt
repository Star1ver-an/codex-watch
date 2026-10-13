package com.codexwatch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.codexwatch.ui.theme.CardBorder
import com.codexwatch.ui.theme.MutedText
import com.codexwatch.ui.theme.PrimaryText

private val CardShape = RoundedCornerShape(22.dp)
private val PillShape = RoundedCornerShape(10.dp)
private val Whitespace = Regex("\\s+")

@Composable
fun StatusDot(color: Color, sizeDp: Int = 7) {
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
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, top = 8.dp, bottom = 4.dp),
    )
}

@Composable
fun StatusPill(text: String, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(color.copy(alpha = 0.13f), PillShape)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.caption2,
            color = color,
            maxLines = 1,
        )
    }
}

@Composable
fun CodexCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    backgroundColor: Color = MaterialTheme.colors.surface,
    borderColor: Color = CardBorder,
    accent: Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val outerModifier = modifier
        .fillMaxWidth()
        .padding(horizontal = 10.dp, vertical = 4.dp)
        .border(1.dp, borderColor, CardShape)

    if (onClick == null) {
        Box(
            modifier = outerModifier.background(backgroundColor, CardShape),
        ) {
            CardContent(accent = accent, content = content)
        }
    } else {
        Card(
            onClick = onClick,
            modifier = outerModifier,
            backgroundPainter = ColorPainter(backgroundColor),
            contentColor = PrimaryText,
            contentPadding = PaddingValues(0.dp),
        ) {
            CardContent(accent = accent, content = content)
        }
    }
}

@Composable
private fun CardContent(
    accent: Color?,
    content: @Composable ColumnScope.() -> Unit,
) {
    Row(verticalAlignment = Alignment.Top) {
        if (accent != null) {
            Box(
                modifier = Modifier
                    .padding(start = 12.dp, top = 14.dp)
                    .width(3.dp)
                    .height(32.dp)
                    .background(accent.copy(alpha = 0.82f), RoundedCornerShape(2.dp)),
            )
            Spacer(Modifier.width(11.dp))
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .padding(
                    start = if (accent == null) 16.dp else 0.dp,
                    end = 16.dp,
                    top = 12.dp,
                    bottom = 13.dp,
                ),
            verticalArrangement = Arrangement.Center,
            content = content,
        )
    }
}

@Composable
fun TitleText(
    text: String,
    modifier: Modifier = Modifier,
    maxLines: Int = 1,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.title3,
        color = PrimaryText,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}

@Composable
fun MetaText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = MutedText,
    maxLines: Int = 1,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.caption2,
        color = color,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}
