package com.codexwatch.data

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.min
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/**
 * Connects to the Codex Watch Bridge over wss://<host>:<port>.
 * Auto-reconnects with exponential backoff; stops after an auth failure (4001/4003).
 * If the saved PC address is stale (DHCP/network change), it rediscovers the
 * bridge over the local UDP discovery port before the next retry.
 */
class BridgeClient(
    private val fingerprint: String,
    private val onMessage: (JSONObject) -> Unit,
    private val onConnState: (ConnState) -> Unit,
    private val onHostDiscovered: (String) -> Unit = {},
) {
    private val http: OkHttpClient = run {
        val tm = PinningTrustManager(fingerprint)
        val ssl = TlsSupport.sslContext(tm)
        OkHttpClient.Builder()
            .sslSocketFactory(ssl.socketFactory, tm)
            .hostnameVerifier { _, _ -> true } // cert fingerprint is the trust anchor
            .pingInterval(30, TimeUnit.SECONDS)
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()
    }
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var shouldRun = false
    @Volatile private var reconnectDelayMs = 1_000L
    @Volatile private var authFailed = false

    @Volatile private var socket: WebSocket? = null
    private var cfgHost = ""
    private var cfgToken = ""

    fun start(host: String, token: String) {
        cfgHost = host.trim()
        cfgToken = token.trim()
        if (shouldRun) return
        shouldRun = true
        authFailed = false
        reconnectDelayMs = 1_000
        Thread { loop() }.apply {
            isDaemon = true
            name = "bridge-client"
            start()
        }
    }

    fun stop() {
        shouldRun = false
        socket?.close(1000, "client stop")
        socket = null
    }

    fun send(text: String): Boolean {
        val s = socket
        return if (s != null) s.send(text) else false
    }

    private fun setState(s: ConnState) = main.post { onConnState(s) }

    private fun loop() {
        while (shouldRun) {
            val opened = tryConnectBlocking()
            if (!shouldRun) break
            if (authFailed) {
                setState(ConnState.AUTH_FAILED)
                shouldRun = false
                break
            }
            if (opened) {
                reconnectDelayMs = 1_000
                // Stay here while the socket lives; onFailure/onClosed nulls it.
                while (shouldRun && socket != null) {
                    Thread.sleep(500)
                }
            }
            if (!shouldRun) break
            if (authFailed) {
                setState(ConnState.AUTH_FAILED)
                shouldRun = false
                break
            }
            if (!opened) {
                val discovered = discoverHost()
                if (!discovered.isNullOrBlank() && discovered != cfgHost) {
                    cfgHost = discovered
                    onHostDiscovered(discovered)
                    reconnectDelayMs = 1_000L
                    continue
                }
            }
            Thread.sleep(reconnectDelayMs)
            reconnectDelayMs = min(reconnectDelayMs * 2, 30_000)
        }
    }

    private fun tryConnectBlocking(): Boolean {
        var opened = false
        val latch = CountDownLatch(1)
        val url = "wss://" + cfgHost
        val request = Request.Builder().url(url).build()

        val listener = object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                opened = true
                setState(ConnState.CONNECTED)
                val hello = JSONObject()
                    .put("type", "hello")
                    .put("token", cfgToken)
                    .put("device", "wear5")
                webSocket.send(hello.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                val obj = try { JSONObject(text) } catch (e: Exception) { null } ?: return
                main.post { onMessage(obj) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                socket = null
                setState(ConnState.DISCONNECTED)
                latch.countDown()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                socket = null
                if (code == 4001 || code == 4003) authFailed = true
                setState(if (authFailed) ConnState.AUTH_FAILED else ConnState.DISCONNECTED)
                latch.countDown()
            }
        }

        setState(ConnState.CONNECTING)
        socket = http.newWebSocket(request, listener)
        latch.await(8, TimeUnit.SECONDS)
        if (!opened) socket?.cancel()
        return opened
    }

    /** Find the bridge even when the PC received a new DHCP address. */
    private fun discoverHost(): String? {
        return try {
            DatagramSocket().use { socket ->
                socket.broadcast = true
                socket.soTimeout = 1200
                val request = "CODEX_WATCH_DISCOVER".toByteArray(Charsets.UTF_8)
                val targets = LinkedHashSet<InetAddress>()
                targets += InetAddress.getByName("255.255.255.255")
                // Some access points filter the limited broadcast. Send to the
                // active interface broadcast as well (e.g. 192.168.3.255).
                NetworkInterface.getNetworkInterfaces()?.toList()?.forEach { nif ->
                    if (!nif.isUp || nif.isLoopback) return@forEach
                    nif.interfaceAddresses.mapNotNull { it.broadcast }.forEach { targets += it }
                }
                for (target in targets) {
                    try {
                        socket.send(DatagramPacket(request, request.size, target, 8788))
                    } catch (_: Exception) {
                        // Try the next interface.
                    }
                }
                val data = ByteArray(256)
                val deadline = System.currentTimeMillis() + 1500
                while (System.currentTimeMillis() < deadline) {
                    try {
                        val packet = DatagramPacket(data, data.size)
                        socket.receive(packet)
                        val reply = String(packet.data, 0, packet.length, Charsets.UTF_8)
                        if (reply.startsWith("CODEX_WATCH_HERE:")) {
                            val port = reply.substringAfter(':').trim().toIntOrNull() ?: 8787
                            return "${packet.address.hostAddress}:$port"
                        }
                    } catch (_: SocketTimeoutException) {
                        break
                    }
                }
                null
            }
        } catch (_: Exception) {
            null
        }
    }
}
