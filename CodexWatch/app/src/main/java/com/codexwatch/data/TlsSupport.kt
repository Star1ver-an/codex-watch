package com.codexwatch.data

import java.io.IOException
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Trust manager that pins the bridge certificate by SHA-256 fingerprint.
 * When fingerprint is blank (first-time pairing), any cert is trusted and the
 * observed fingerprint is captured via onCertSeen.
 */
class PinningTrustManager(
    private val pinnedFingerprint: String,
    private val onCertSeen: ((fingerprint: String) -> Unit)? = null,
) : X509TrustManager {

    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) {}

    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
        if (chain.isEmpty()) throw IOException("empty cert chain")
        val fp = sha256(chain[0].encoded)
        onCertSeen?.invoke(fp)
        if (pinnedFingerprint.isBlank()) return // pairing mode: trust + capture
        if (!fp.equals(pinnedFingerprint, ignoreCase = true)) {
            throw CertificateException("bridge certificate mismatch (fp=$fp)")
        }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()

    companion object {
        fun sha256(der: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(der)
                .joinToString("") { "%02X".format(it) }
    }
}

object TlsSupport {
    fun sslContext(trustManager: TrustManager): SSLContext =
        SSLContext.getInstance("TLS").apply {
            init(null, arrayOf<TrustManager>(trustManager), null)
        }
}
