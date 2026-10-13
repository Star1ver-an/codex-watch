package com.codexwatch.ui

import android.app.Application
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.AndroidViewModel
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import com.codexwatch.data.ApprovalEntry
import com.codexwatch.data.ApprovalHistoryEntry
import com.codexwatch.data.ApprovalHistoryStore
import com.codexwatch.data.BridgeClient
import com.codexwatch.data.ControlFeedback
import com.codexwatch.data.InstructionFeedback
import com.codexwatch.data.ConnState
import com.codexwatch.data.PairingClient
import com.codexwatch.data.PairingStore
import com.codexwatch.data.ThreadState
import com.codexwatch.data.parseApproval
import com.codexwatch.data.parseThread
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException
import kotlin.concurrent.thread
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

@Immutable
data class UiState(
    val conn: ConnState = ConnState.DISCONNECTED,
    val threads: List<ThreadState> = emptyList(),
    val host: String = "",
    val token: String = "",
    val pin: String = "",
    val lastControl: ControlFeedback? = null,
    val lastInstruction: InstructionFeedback? = null,
)

@Stable
class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val store = PairingStore(app)
    private val approvalHistoryStore = ApprovalHistoryStore(app)
    private val main = Handler(Looper.getMainLooper())
    private val parser: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "watch-message-parser").apply { isDaemon = true }
    }
    private val pendingThreadUpdates = LinkedHashMap<String, ThreadState>()
    private var threadFlushScheduled = false
    private val flushThreadUpdatesRunnable = Runnable { flushThreadUpdates() }
    private val client = BridgeClient(
        fingerprint = store.fingerprint,
        onMessage = ::handleMessage,
        onConnState = { s -> merge { it.copy(conn = s) } },
        onHostDiscovered = { host ->
            store.host = host
            main.post { merge { it.copy(host = host) } }
        },
    )

    private val _ui = androidx.compose.runtime.mutableStateOf(
        UiState(host = store.host, token = store.token)
    )
    val ui: androidx.compose.runtime.State<UiState> = _ui

    private val _discovered = androidx.compose.runtime.mutableStateOf<List<String>>(emptyList())
    val discovered: androidx.compose.runtime.State<List<String>> = _discovered

    private val _searching = androidx.compose.runtime.mutableStateOf(false)
    val searching: androidx.compose.runtime.State<Boolean> = _searching

    private val _approvalHistory = androidx.compose.runtime.mutableStateOf<List<ApprovalHistoryEntry>>(emptyList())
    val approvalHistory: androidx.compose.runtime.State<List<ApprovalHistoryEntry>> = _approvalHistory

    private var nsdManager: NsdManager? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val notifiedApprovals = mutableSetOf<String>()

    init {
        // Auto-connect on launch if credentials were saved previously.
        _approvalHistory.value = approvalHistoryStore.recent()
        if (store.host.isNotBlank() && store.token.isNotBlank()) connect()
    }

    private fun merge(update: (UiState) -> UiState) {
        _ui.value = update(_ui.value)
    }

    fun setHost(v: String) = merge { it.copy(host = v) }
    fun setToken(v: String) = merge { it.copy(token = v) }
    fun setPin(v: String) = merge { it.copy(pin = v) }

    fun connect() {
        val h = _ui.value.host.trim()
        val t = _ui.value.token.trim()
        if (h.isEmpty() || t.isEmpty()) return
        store.save(h, t)
        client.start(h, t)
    }

    fun disconnect() {
        client.stop()
        merge { it.copy(conn = ConnState.DISCONNECTED) }
    }

    fun decide(approvalId: String, approve: Boolean, note: String? = null) {
        val state = _ui.value
        val pair = state.threads.asSequence()
            .flatMap { thread -> thread.pendingApprovals.asSequence().map { thread to it } }
            .firstOrNull { it.second.id == approvalId } ?: return

        val obj = JSONObject()
            .put("type", "approval_result")
            .put("approvalId", approvalId)
            .put("decision", if (approve) "approve" else "reject")
        if (!note.isNullOrBlank()) obj.put("note", note.take(120))

        if (!client.send(obj.toString())) return

        approvalHistoryStore.record(
            approval = pair.second,
            threadId = pair.first.id,
            threadTitle = pair.first.title,
            decision = if (approve) "approve" else "reject",
        )
        _approvalHistory.value = approvalHistoryStore.recent()
        refreshComplication()
    }

    fun sendTaskControl(threadId: String, action: String, reason: String? = null) {
        val obj = JSONObject()
            .put("type", "task_control")
            .put("threadId", threadId)
            .put("action", action)
        if (!reason.isNullOrBlank()) obj.put("reason", reason.take(160))
        if (!client.send(obj.toString())) {
            merge {
                it.copy(
                    lastControl = ControlFeedback(
                        threadId = threadId,
                        action = action,
                        accepted = false,
                        supported = false,
                        message = "桥接未连接，操作未发送",
                        atMs = System.currentTimeMillis(),
                    )
                )
            }
        }
    }

    fun sendThreadMessage(threadId: String, text: String) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        val obj = JSONObject()
            .put("type", "thread_message")
            .put("threadId", threadId)
            .put("text", clean.take(240))
            .put("source", "watch_quick_reply")
            .put("requestId", java.util.UUID.randomUUID().toString())
        if (!client.send(obj.toString())) {
            merge {
                it.copy(
                    lastControl = ControlFeedback(
                        threadId = threadId,
                        action = "send_message",
                        accepted = false,
                        supported = true,
                        message = "桥接未连接，快捷指令未发送",
                        atMs = System.currentTimeMillis(),
                    )
                )
            }
        }
    }

    // ---- UDP broadcast discovery (primary, reliable on home LAN) ----

    fun udpDiscover() {
        _discovered.value = emptyList()
        _searching.value = true
        thread(name = "udp-discover") {
            val results = LinkedHashSet<String>()
            try {
                val socket = DatagramSocket().apply {
                    broadcast = true
                    soTimeout = 1200
                }
                val msg = "CODEX_WATCH_DISCOVER".toByteArray()
                val targets = LinkedHashSet<String>()
                targets += "255.255.255.255"
                NetworkInterface.getNetworkInterfaces()?.toList()?.forEach { nif ->
                    if (!nif.isUp || nif.isLoopback) return@forEach
                    nif.interfaceAddresses.mapNotNull { it.broadcast }
                        .mapNotNull { it.hostAddress }
                        .forEach { targets += it }
                }
                for (target in targets) {
                    try {
                        socket.send(DatagramPacket(msg, msg.size, InetAddress.getByName(target), 8788))
                    } catch (e: Exception) {
                        // try next target
                    }
                }
                val buf = ByteArray(256)
                while (true) {
                    try {
                        val p = DatagramPacket(buf, buf.size)
                        socket.receive(p)
                        val data = String(p.data, 0, p.length)
                        if (data.startsWith("CODEX_WATCH_HERE")) {
                            results.add("${p.address.hostAddress}:8787")
                        }
                    } catch (e: SocketTimeoutException) {
                        break
                    } catch (e: Exception) {
                        break
                    }
                }
                socket.close()
            } catch (e: Exception) {
                // socket setup failed
            }
            main.post {
                _discovered.value = results.toList()
                _searching.value = false
            }
        }
    }

    // ---- mDNS discovery (secondary) ----

    fun startDiscovery() {
        if (discoveryListener != null) return
        val nm = getApplication<Application>()
            .getSystemService(Context.NSD_SERVICE) as NsdManager
        nsdManager = nm
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                discoveryListener = null
            }
            override fun onDiscoveryStopped(serviceType: String) {
                discoveryListener = null
            }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                val name = serviceInfo.serviceName ?: return
                if (!name.contains("Codex", ignoreCase = true)) return
                nm.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        val hostAddr = info.host?.hostAddress ?: return
                        val entry = "$hostAddr:${info.port}"
                        if (!_discovered.value.contains(entry)) {
                            _discovered.value = _discovered.value + entry
                        }
                    }
                })
            }
        }
        discoveryListener = listener
        nm.discoverServices("_codex-watch._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
    }

    fun stopDiscovery() {
        val l = discoveryListener ?: return
        try { nsdManager?.stopServiceDiscovery(l) } catch (e: Exception) {}
        discoveryListener = null
    }

    // ---- PIN pairing ----

    fun pairWithPin(host: String, pin: String, onResult: (ok: Boolean, message: String) -> Unit) {
        PairingClient.exchange(host.trim(), pin.trim()) { ok, tokenOrError, fp ->
            if (ok && !tokenOrError.isNullOrEmpty()) {
                if (!fp.isNullOrEmpty()) store.fingerprint = fp
                setHost(host.trim())
                setToken(tokenOrError)
                store.save(host.trim(), tokenOrError)
                connect()
                main.post { onResult(true, "配对成功,已连接") }
            } else {
                main.post { onResult(false, tokenOrError ?: "配对失败") }
            }
        }
    }

    private fun handleMessage(msg: JSONObject) {
        when (msg.optString("type")) {
            "snapshot" -> {
                val arr = msg.optJSONArray("threads") ?: return
                parser.execute {
                    val list = ArrayList<ThreadState>(arr.length())
                    for (i in 0 until arr.length()) {
                        list.add(parseThread(arr.getJSONObject(i)))
                    }
                    main.post {
                        pendingThreadUpdates.clear()
                        applySnapshot(list)
                    }
                }
            }
            "thread_update" -> {
                val obj = msg.optJSONObject("thread") ?: return
                parser.execute {
                    val nt = parseThread(obj)
                    main.post { enqueueThreadUpdate(nt) }
                }
            }
            "approval_request" -> {
                val aObj = msg.optJSONObject("approval") ?: return
                val entry = parseApproval(aObj)
                if (entry.id !in notifiedApprovals) {
                    notifiedApprovals.add(entry.id)
                    val threadTitle = msg.optString("threadTitle")
                    com.codexwatch.data.ApprovalNotifier.show(getApplication(), threadTitle, entry)
                }
            }
            "watch_instruction_update" -> {
                val obj = msg.optJSONObject("instruction") ?: return
                val feedback = InstructionFeedback(
                    id = obj.optString("id"),
                    threadId = obj.optString("threadId"),
                    status = obj.optString("status", "queued"),
                    text = obj.optString("text"),
                    result = obj.optString("result").ifBlank { null },
                    atMs = obj.optLong(
                        "completedAtMs",
                        obj.optLong("deliveredAtMs", obj.optLong("createdAtMs", System.currentTimeMillis())),
                    ),
                )
                main.post { merge { it.copy(lastInstruction = feedback) } }
            }
            "control_result" -> {
                val feedback = ControlFeedback(
                    threadId = msg.optString("threadId"),
                    action = msg.optString("action"),
                    accepted = msg.optBoolean("accepted", false),
                    supported = msg.optBoolean("supported", false),
                    message = msg.optString("message", "已处理"),
                    atMs = msg.optLong("tsMs", System.currentTimeMillis()),
                )
                main.post { merge { it.copy(lastControl = feedback) } }
            }
            else -> Unit
        }
    }

    private fun applySnapshot(list: List<ThreadState>) {
        for (t in list) {
            for (a in t.pendingApprovals) {
                if (a.id !in notifiedApprovals) {
                    notifiedApprovals.add(a.id)
                    com.codexwatch.data.ApprovalNotifier.show(getApplication(), t.title, a)
                }
            }
        }
        merge { it.copy(threads = capThreads(list)) }
        refreshComplication()
    }

    private fun enqueueThreadUpdate(thread: ThreadState) {
        pendingThreadUpdates[thread.id] = thread
        if (!threadFlushScheduled) {
            threadFlushScheduled = true
            main.postDelayed(flushThreadUpdatesRunnable, 500L)
        }
    }

    private fun flushThreadUpdates() {
        threadFlushScheduled = false
        if (pendingThreadUpdates.isEmpty()) return
        val batch = pendingThreadUpdates.values.toList()
        pendingThreadUpdates.clear()
        merge { state ->
            val byId = state.threads.associateBy { it.id }.toMutableMap()
            for (thread in batch) byId[thread.id] = thread
            state.copy(threads = capThreads(byId.values.toList()))
        }
    }

    fun refreshComplication() {
        try {
            val cn = android.content.ComponentName(getApplication(), com.codexwatch.complications.StatusComplicationService::class.java)
            androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
                .create(getApplication(), cn)
                .requestUpdateAll()
        } catch (e: Exception) {
            // best effort
        }
    }

    private fun capThreads(threads: List<ThreadState>): List<ThreadState> {
        val urgent = threads.filter { it.pendingApprovals.isNotEmpty() }
        val recent = threads.sortedByDescending { it.lastActivityMs }.take(5)
        return (recent + urgent).distinctBy { it.id }.sortedByDescending { it.lastActivityMs }
    }

    fun allApprovals(): List<Pair<ThreadState, ApprovalEntry>> =
        _ui.value.threads.flatMap { t -> t.pendingApprovals.map { t to it } }

    override fun onCleared() {
        client.stop()
        main.removeCallbacks(flushThreadUpdatesRunnable)
        parser.shutdownNow()
        super.onCleared()
    }
}
