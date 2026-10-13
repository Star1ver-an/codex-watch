package com.codexwatch.tiles

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.codexwatch.CodexWatchApp
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

private const val RESOURCES_VERSION = "1"

private fun sizedText(text: String, size: Float): LayoutElementBuilders.Text =
    LayoutElementBuilders.Text.Builder()
        .setText(text)
        .setFontStyle(
            LayoutElementBuilders.FontStyle.Builder()
                .setSize(DimensionBuilders.SpProp.Builder().setValue(size).build())
                .build()
        )
        .build()

class StatusTileService : TileService() {

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val vm = try { (applicationContext as CodexWatchApp).vm } catch (e: Exception) { null }
        val ui = vm?.ui?.value
        val running = ui?.threads?.count { it.phase == "running" } ?: 0
        val waiting = ui?.threads?.sumOf { it.pendingApprovals.size } ?: 0
        val conn = when (ui?.conn?.name) {
            "CONNECTED" -> "已连接"
            "CONNECTING" -> "连接中"
            "AUTH_FAILED" -> "认证失败"
            else -> "离线"
        }

        val clickable = ModifiersBuilders.Clickable.Builder()
            .setOnClick(
                ActionBuilders.LaunchAction.Builder()
                    .setAndroidActivity(
                        ActionBuilders.AndroidActivity.Builder()
                            .setPackageName("com.codexwatch")
                            .setClassName("com.codexwatch.MainActivity")
                            .build()
                    )
                    .build()
            )
            .build()

        val column = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.ExpandedDimensionProp.Builder().build())
            .addContent(sizedText("Codex · $conn", 12f))
            .addContent(sizedText("运行 $running", 20f))
            .addContent(sizedText("待审批 $waiting", 16f))
            .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(clickable).build())
            .build()

        val tile = TileBuilders.Tile.Builder()
            .setResourcesVersion(RESOURCES_VERSION)
            .setTileTimeline(
                TimelineBuilders.Timeline.Builder()
                    .addTimelineEntry(
                        TimelineBuilders.TimelineEntry.Builder()
                            .setLayout(
                                LayoutElementBuilders.Layout.Builder().setRoot(column).build()
                            )
                            .build()
                    )
                    .build()
            )
            .build()

        return Futures.immediateFuture(tile)
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> {
        return Futures.immediateFuture(
            ResourceBuilders.Resources.Builder().setVersion(RESOURCES_VERSION).build()
        )
    }
}
