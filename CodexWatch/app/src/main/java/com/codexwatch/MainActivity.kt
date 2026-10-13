package com.codexwatch

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import android.os.Bundle
import android.os.PowerManager
import android.content.Intent
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import com.codexwatch.ui.ApprovalHistoryScreen
import com.codexwatch.ui.PairingScreen
import com.codexwatch.ui.QuickResultScreen
import com.codexwatch.ui.TaskDetailScreen
import com.codexwatch.ui.TaskListScreen
import com.codexwatch.ui.theme.CodexWatchTheme

class MainActivity : ComponentActivity() {

    private val requestNotifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val vm = (application as CodexWatchApp).vm
        requestNotificationPermissionIfNeeded()
        requestIgnoreBatteryOptimization()
        refreshTile()
        setContent {
            CodexWatchTheme {
                AppNavHost(vm)
            }
        }
    }

    private fun refreshTile() {
        try {
            androidx.wear.tiles.TileService.getUpdater(this).requestUpdate(
                com.codexwatch.tiles.StatusTileService::class.java
            )
        } catch (e: Exception) {
            // tile update is best-effort
        }
    }

    private val batteryIntentLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { }

    private fun requestIgnoreBatteryOptimization() {
        try {
            val pm = getSystemService(PowerManager::class.java)
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName"))
                batteryIntentLauncher.launch(intent)
            }
        } catch (e: Exception) {
            // best effort
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                requestNotifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }
}

@Composable
fun AppNavHost(vm: com.codexwatch.ui.AppViewModel) {
    val ui by vm.ui
    val nav = rememberSwipeDismissableNavController()
    val start = if (ui.host.isBlank() || ui.token.isBlank()) "pairing" else "list"

    SwipeDismissableNavHost(navController = nav, startDestination = start) {
        composable("pairing") {
            PairingScreen(
                ui = ui,
                vm = vm,
                onConnected = {
                    nav.navigate("list") { popUpTo("pairing") { inclusive = true } }
                },
            )
        }
        composable("list") {
            TaskListScreen(
                ui = ui,
                vm = vm,
                onOpen = { id -> nav.navigate("detail/$id") },
                onPair = { nav.navigate("pairing") },
                onHistory = { nav.navigate("history") },
            )
        }
        composable("history") {
            ApprovalHistoryScreen(vm)
        }
        composable("quick-result") {
            QuickResultScreen(vm)
        }
        composable("detail/{id}") { backStackEntry ->
            val id = backStackEntry.arguments?.getString("id") ?: ""
            TaskDetailScreen(
                ui = ui,
                vm = vm,
                threadId = id,
                onOpenResult = { nav.navigate("quick-result") },
            )
        }
    }
}
