package com.codexwatch.data

import android.content.Context

class PairingStore(context: Context) {
    private val prefs = context.getSharedPreferences("codex_watch_pairing", Context.MODE_PRIVATE)

    var host: String
        get() = prefs.getString(KEY_HOST, "") ?: ""
        set(v) { prefs.edit().putString(KEY_HOST, v).apply() }

    var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(v) { prefs.edit().putString(KEY_TOKEN, v).apply() }

    var fingerprint: String
        get() = prefs.getString(KEY_FP, "") ?: ""
        set(v) { prefs.edit().putString(KEY_FP, v).apply() }

    fun save(host: String, token: String) {
        this.host = host
        this.token = token
    }

    companion object {
        private const val KEY_HOST = "host"
        private const val KEY_TOKEN = "token"
        private const val KEY_FP = "fingerprint"
    }
}
