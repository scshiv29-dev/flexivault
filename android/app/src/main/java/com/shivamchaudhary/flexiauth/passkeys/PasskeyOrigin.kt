package com.shivamchaudhary.flexiauth.passkeys

import android.content.Context
import androidx.credentials.provider.CallingAppInfo
import java.net.URI
import java.security.MessageDigest

/**
 * Resolves the WebAuthn origin for a provider request.
 *
 * Browser calls set clientDataHash and carry the website origin in the
 * privileged calling-app metadata. Native app calls have no clientDataHash, so
 * their origin is the Android APK signing-key hash defined by Credential
 * Manager.
 */
object PasskeyOrigin {
  private const val ALLOWLIST_ASSET = "passkey_privileged_apps.json"
  @Volatile
  private var cachedAllowlist: String? = null

  fun resolve(
    context: Context,
    callingInfo: CallingAppInfo?,
    clientDataHash: ByteArray?,
  ): String {
    if (clientDataHash != null) {
      val info = callingInfo ?: return ""
      return try {
        info.getOrigin(allowlist(context))?.trim().orEmpty()
      } catch (_: Exception) {
        ""
      }
    }
    return apkKeyHash(callingInfo)
  }

  fun fallbackRpId(origin: String): String? {
    if (origin.isBlank()) return null
    if (origin.startsWith("android:apk-key-hash:")) return null
    return webOriginHost(origin)
  }

  /**
   * Browser passkeys must come from a secure web origin. Plain HTTP is allowed
   * only for loopback development origins.
   */
  fun isWebOrigin(origin: String): Boolean = webOriginHost(origin) != null

  fun matchesRpId(origin: String, rpId: String): Boolean {
    val host = webOriginHost(origin) ?: return false
    val id = rpId.trim().lowercase()
    return host == id || host.endsWith(".$id")
  }

  fun isNativeOrigin(origin: String): Boolean =
    origin.startsWith("android:apk-key-hash:") &&
      origin.length > "android:apk-key-hash:".length

  /**
   * Browser calls must carry a secure web origin from the privileged-app
   * allowlist, and that origin must be the RP or a subdomain of it. If we signed
   * a browser-supplied clientDataHash without this check, any app could ask for
   * an assertion and relay it with a forged clientDataJSON. Native calls are
   * bound to the caller's APK signing certificate instead.
   */
  fun isAllowedCaller(hash: ByteArray?, origin: String, rpId: String): Boolean {
    return if (hash != null) {
      isWebOrigin(origin) && matchesRpId(origin, rpId)
    } else {
      isNativeOrigin(origin)
    }
  }

  private fun webOriginHost(origin: String): String? {
    if (origin.isBlank()) return null
    return try {
      val uri = URI(origin)
      val scheme = uri.scheme?.lowercase() ?: return null
      val host = uri.host?.lowercase() ?: return null
      when {
        scheme == "https" -> host
        scheme == "http" && (host == "localhost" || host == "127.0.0.1") -> host
        else -> null
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun apkKeyHash(info: CallingAppInfo?): String {
    val signingInfo = info?.signingInfo ?: return ""
    val signature = signingInfo.apkContentsSigners.firstOrNull() ?: return ""
    val digest = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
    return "android:apk-key-hash:${PasskeyCrypto.base64UrlEncode(digest)}"
  }

  @Synchronized
  private fun allowlist(context: Context): String {
    cachedAllowlist?.let { return it }
    val value = try {
      context.applicationContext.assets
        .open(ALLOWLIST_ASSET)
        .bufferedReader(Charsets.UTF_8)
        .use { it.readText() }
    } catch (_: Exception) {
      ""
    }
    cachedAllowlist = value
    return value
  }
}
