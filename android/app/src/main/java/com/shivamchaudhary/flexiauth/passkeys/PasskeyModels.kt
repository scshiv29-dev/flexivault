package com.shivamchaudhary.flexiauth.passkeys

import org.json.JSONArray
import org.json.JSONObject

/**
 * A passkey mirrored into the encrypted vault. The private key is a P-256
 * scalar encoded as unpadded base64url so it can travel through JSON and the
 * existing vault encryption without introducing another binary format.
 */
data class PasskeyCredential(
  val vaultItemId: String,
  val credentialId: String,
  val rpId: String,
  val userName: String,
  val displayName: String,
  val userHandle: String,
  val privateKey: String,
  val publicKeyX: String,
  val publicKeyY: String,
  val createdAt: Long,
  val lastUsedAt: Long,
  val signCount: Long,
  val pending: Boolean,
) {
  fun toJson(): JSONObject = JSONObject()
    .put("vaultItemId", vaultItemId)
    .put("credentialId", credentialId)
    .put("rpId", rpId)
    .put("userName", userName)
    .put("displayName", displayName)
    .put("userHandle", userHandle)
    .put("privateKey", privateKey)
    .put("publicKeyX", publicKeyX)
    .put("publicKeyY", publicKeyY)
    .put("createdAt", createdAt)
    .put("lastUsedAt", lastUsedAt)
    .put("signCount", signCount)
    .put("pending", pending)

  companion object {
    fun fromJson(value: JSONObject): PasskeyCredential = PasskeyCredential(
      vaultItemId = value.optString("vaultItemId"),
      credentialId = value.optString("credentialId"),
      rpId = value.optString("rpId"),
      userName = value.optString("userName"),
      displayName = value.optString("displayName"),
      userHandle = value.optString("userHandle"),
      privateKey = value.optString("privateKey"),
      publicKeyX = value.optString("publicKeyX"),
      publicKeyY = value.optString("publicKeyY"),
      createdAt = value.optLong("createdAt", 0L),
      lastUsedAt = value.optLong("lastUsedAt", 0L),
      signCount = value.optLong("signCount", 0L),
      pending = value.optBoolean("pending", false),
    )
  }
}

data class PasskeyCreationOptions(
  val challenge: String,
  val rpId: String,
  val rpName: String,
  val userId: String,
  val userName: String,
  val userDisplayName: String,
  val excludeCredentialIds: List<String>,
)

data class PasskeyGetOptions(
  val challenge: String,
  val rpId: String,
  val allowCredentialIds: List<String>,
  val userVerification: String,
)

object PasskeyRequestParser {
  private const val MAX_ID_BYTES = 1024

  fun parseCreation(json: String, fallbackRpId: String? = null): PasskeyCreationOptions? {
    return try {
      val root = JSONObject(json)
      val challenge = PasskeyCrypto.normaliseBase64Url(root.optString("challenge"))
        ?: return null
      val rp = root.optJSONObject("rp")
      val rpId = rp?.optString("id").orEmpty()
        .trim()
        .lowercase()
        .ifBlank { fallbackRpId?.trim()?.lowercase().orEmpty() }
      if (!isRpId(rpId)) return null

      val user = root.optJSONObject("user") ?: return null
      val userId = PasskeyCrypto.normaliseBase64Url(user.optString("id"))
        ?: return null
      if (userId.isEmpty()) return null
      val userName = clean(user.optString("name"), 500).ifBlank { "Passkey" }
      val displayName = clean(user.optString("displayName"), 500).ifBlank { userName }

      if (!supportsEs256(root.optJSONArray("pubKeyCredParams"))) return null

      PasskeyCreationOptions(
        challenge = challenge,
        rpId = rpId,
        rpName = clean(rp?.optString("name").orEmpty(), 200),
        userId = userId,
        userName = userName,
        userDisplayName = displayName,
        excludeCredentialIds = credentialIds(root.optJSONArray("excludeCredentials")),
      )
    } catch (_: Exception) {
      null
    }
  }

  fun parseGet(json: String, fallbackRpId: String? = null): PasskeyGetOptions? {
    return try {
      val root = JSONObject(json)
      val challenge = PasskeyCrypto.normaliseBase64Url(root.optString("challenge"))
        ?: return null
      val rpId = root.optString("rpId")
        .trim()
        .lowercase()
        .ifBlank { fallbackRpId?.trim()?.lowercase().orEmpty() }
      if (!isRpId(rpId)) return null
      PasskeyGetOptions(
        challenge = challenge,
        rpId = rpId,
        allowCredentialIds = credentialIds(root.optJSONArray("allowCredentials")),
        userVerification = clean(root.optString("userVerification"), 32).lowercase(),
      )
    } catch (_: Exception) {
      null
    }
  }

  fun isRpId(value: String): Boolean {
    if (value.isEmpty() || value.length > 253) return false
    if (value == "localhost") return true
    if (!value.contains('.')) return false
    if (value.startsWith('.') || value.endsWith('.') || value.contains("..")) return false
    if (value.contains('/') || value.contains(':') || value.contains('@')) return false
    return value.all { it in 'a'..'z' || it in '0'..'9' || it == '-' || it == '.' }
  }

  private fun supportsEs256(params: JSONArray?): Boolean {
    if (params == null || params.length() == 0) return true
    for (index in 0 until minOf(params.length(), 32)) {
      val value = params.optJSONObject(index) ?: continue
      if (value.optInt("alg", Int.MIN_VALUE) == -7) return true
    }
    return false
  }

  private fun credentialIds(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val result = ArrayList<String>()
    for (index in 0 until minOf(array.length(), 64)) {
      val entry = array.optJSONObject(index) ?: continue
      val id = PasskeyCrypto.normaliseBase64Url(entry.optString("id")) ?: continue
      val rawLength = try {
        PasskeyCrypto.base64UrlDecode(id).size
      } catch (_: Exception) {
        0
      }
      if (rawLength in 1..MAX_ID_BYTES) result.add(id)
    }
    return result
  }

  private fun clean(value: String, max: Int): String =
    value.trim().replace(Regex("[\\u0000-\\u001f\\u007f]"), "").take(max)
}
