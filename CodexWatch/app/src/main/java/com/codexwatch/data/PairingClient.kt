package com.codexwatch.data

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** One-shot PIN pairing exchange against the bridge (over TLS, trusting + capturing the cert). */
object PairingClient {
    fun exchange(
        host: String,
        pin: String,
        onResult: (ok: Boolean, tokenOrError: String?, fingerprint: String?) -> Unit,
    ) {
        val main = Handler(Looper.getMainLooper())
        var done = false
        var seenFingerprint: String? = null

        fun finish(ok: Boolean, msg: String?) {
            if (done) return
            done = true
            main.post { onResult(ok, msg, seenFingerprint) }
        }

        val base = OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .build()
        val tm = PinningTrustManager("", { fp -> seenFingerprint = fp })
        val ssl = TlsSupport.sslContext(tm)
        val client = base.newBuilder()
            .sslSocketFactory(ssl.socketFactory, tm)
            .hostnameVerifier { _, _ -> true } // fingerprint capture is the trust anchor during pairing
            .build()

        val ws = client.newWebSocket(
            Request.Builder().url("wss://$host").build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(
                        JSONObject()
                            .put("type", "hello")
                            .put("pin", pin)
                            .put("device", "watch5-pair")
                            .toString()
                    )
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val msg = try { JSONObject(text) } catch (e: Exception) { return }
                    when (msg.optString("type")) {
                        "pair_ok" -> {
                            finish(true, msg.optString("token"))
                            webSocket.close(1000, "paired")
                        }
                        "error" -> {
                            finish(false, msg.optString("message", "配对失败"))
                        }
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    finish(false, "连接失败: ${t.message}")
                }
            }
        )
        Handler(Looper.getMainLooper()).postDelayed({
            finish(false, "配对超时")
            ws.cancel()
            client.dispatcher.executorService.shutdown()
        }, 10000)
    }
}
