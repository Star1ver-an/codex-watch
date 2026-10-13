package com.codexwatch.data

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.codexwatch.CodexWatchApp

class ApprovalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getStringExtra("id") ?: return
        val approve = intent.getBooleanExtra("approve", false)
        val vm = (context.applicationContext as CodexWatchApp).vm
        vm.decide(id, approve)
        ApprovalNotifier.cancel(context)
    }
}
