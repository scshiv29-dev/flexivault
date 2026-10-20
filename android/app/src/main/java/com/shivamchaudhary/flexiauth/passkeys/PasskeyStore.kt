package com.shivamchaudhary.flexiauth.passkeys

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Keystore-encrypted passkey store used by the Android 14 credential provider.
 *
 * The credential provider must be able to sign while the React Native app is
 * locked. A pending create is queued here and imported into the encrypted vault
 * after unlock; the vault then mirrors every passkey back through [sync] so a
 * restored device can recreate the native store.
 */
object PasskeyStore {
  private const val PREFS = "flexivault_passkeys"
  private const val KEY_PAYLOAD = "payload"
  private const val KEY_ALIAS = "flexivault.passkey.v1"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val VERSION = 1
  private const val MAX_CREDENTIALS = 500
  private const val MAX_PAYLOAD_BYTES = 2 * 1024 * 1024
  private val ITEM_ID = Regex("^[A-Za-z0-9_-]{8,64}$")
  private const val P256_BYTES = 32
  private const val MAX_CREDENTIAL_ID_BYTES = 1024

  @Synchronized
  fun read(context: Context): List<PasskeyCredential> {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val payload = prefs.getString(KEY_PAYLOAD, null) ?: return emptyList()
    return try {
      parse(decrypt(payload))
    } catch (_: Exception) {
      clear(context)
      emptyList()
    }
  }

  @Synchronized
  fun add(context: Context, credential: PasskeyCredential): Boolean {
    val sanitized = sanitize(credential) ?: return false
    return try {
      val current = read(context)
        .filterNot { it.credentialId == sanitized.credentialId }
        .toMutableList()
      current.add(sanitized)
      while (current.size > MAX_CREDENTIALS) {
        val oldest = current.minByOrNull { it.createdAt } ?: break
        current.remove(oldest)
      }
      write(context, current)
      true
    } catch (_: Exception) {
      false
    }
  }

  fun find(context: Context, credentialId: String): PasskeyCredential? {
    val normalised = PasskeyCrypto.normaliseBase64Url(credentialId) ?: return null
    return read(context).firstOrNull { it.credentialId == normalised }
  }

  fun readPendingJson(context: Context): String =
    encode(read(context).filter { it.pending })

  @Synchronized
  fun clearPending(context: Context, credentialIds: Set<String>) {
    if (credentialIds.isEmpty()) return
    val current = read(context)
    if (current.isEmpty()) return
    val normalised = credentialIds.mapNotNull(PasskeyCrypto::normaliseBase64Url).toSet()
    val updated = current.map {
      if (it.credentialId in normalised) it.copy(pending = false) else it
    }
    if (updated != current) write(context, updated)
  }

  /**
   * Mirrors the decrypted vault into the native store. Pending native creates
   * that have not been imported yet are preserved. Credentials are removed only
   * when the vault supplies a tombstoned vaultItemId, so an empty local cache
   * before the first server pull cannot erase a working provider.
   */
  @Synchronized
  fun sync(context: Context, json: String) {
    val incoming = parse(json)
    val deletedItemIds = parseDeletedItemIds(json)
    val existing = read(context)
    val existingById = existing.associateBy { it.credentialId }
    val byId = LinkedHashMap<String, PasskeyCredential>()

    for (credential in existing) byId[credential.credentialId] = credential
    for (credential in incoming) {
      val sanitized = sanitize(credential) ?: continue
      val pending = existingById[sanitized.credentialId]?.pending == true
      // A vault item has at most one passkey. If its credential ID changed,
      // remove the old native entry before inserting the replacement.
      byId.entries.removeIf {
        it.value.vaultItemId == sanitized.vaultItemId &&
          it.key != sanitized.credentialId
      }
      byId[sanitized.credentialId] = sanitized.copy(pending = pending)
    }
    if (deletedItemIds.isNotEmpty()) {
      byId.entries.removeIf { it.value.vaultItemId in deletedItemIds }
    }
    write(context, byId.values.toList())
  }

  @Synchronized
  fun markUsed(context: Context, credentialId: String, now: Long = System.currentTimeMillis()) {
    val normalised = PasskeyCrypto.normaliseBase64Url(credentialId) ?: return
    val current = read(context)
    if (current.isEmpty()) return
    var changed = false
    val updated = current.map {
      if (it.credentialId == normalised) {
        changed = true
        it.copy(lastUsedAt = now)
      } else {
        it
      }
    }
    if (changed) write(context, updated)
  }

  @Synchronized
  fun clear(context: Context) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_PAYLOAD)
      .apply()
  }

  private fun sanitize(value: PasskeyCredential): PasskeyCredential? {
    val credentialId = PasskeyCrypto.normaliseBase64Url(value.credentialId) ?: return null
    val userHandle = PasskeyCrypto.normaliseBase64Url(value.userHandle) ?: return null
    val privateKey = PasskeyCrypto.normaliseBase64Url(value.privateKey) ?: return null
    val publicX = PasskeyCrypto.normaliseBase64Url(value.publicKeyX) ?: return null
    val publicY = PasskeyCrypto.normaliseBase64Url(value.publicKeyY) ?: return null
    val rpId = value.rpId.trim().lowercase()
    if (!PasskeyRequestParser.isRpId(rpId)) return null
    if (credentialId.isEmpty() || userHandle.isEmpty()) return null
    if (PasskeyCrypto.base64UrlDecode(credentialId).size !in 1..MAX_CREDENTIAL_ID_BYTES) {
      return null
    }
    if (PasskeyCrypto.base64UrlDecode(privateKey).size != P256_BYTES) return null
    if (PasskeyCrypto.base64UrlDecode(publicX).size != P256_BYTES) return null
    if (PasskeyCrypto.base64UrlDecode(publicY).size != P256_BYTES) return null

    val now = System.currentTimeMillis()
    val userName = value.userName.trim().take(500).ifBlank { rpId }
    return PasskeyCredential(
      vaultItemId = value.vaultItemId.takeIf { ITEM_ID.matches(it) }
        ?: UUID.randomUUID().toString(),
      credentialId = credentialId,
      rpId = rpId,
      userName = userName,
      displayName = value.displayName.trim().take(500).ifBlank { userName },
      userHandle = userHandle,
      privateKey = privateKey,
      publicKeyX = publicX,
      publicKeyY = publicY,
      createdAt = value.createdAt.takeIf { it > 0L } ?: now,
      lastUsedAt = value.lastUsedAt.coerceAtLeast(0L),
      signCount = 0L,
      pending = value.pending,
    )
  }

  private fun parseDeletedItemIds(json: String): Set<String> {
    if (json.isBlank()) return emptySet()
    return try {
      val array = JSONObject(json).optJSONArray("deletedVaultItemIds") ?: return emptySet()
      val result = HashSet<String>()
      for (index in 0 until minOf(array.length(), MAX_CREDENTIALS)) {
        val value = array.optString(index).trim()
        if (ITEM_ID.matches(value)) result.add(value)
      }
      result
    } catch (_: Exception) {
      emptySet()
    }
  }

  private fun encode(credentials: List<PasskeyCredential>): String {
    val array = JSONArray()
    for (credential in credentials) array.put(credential.toJson())
    return JSONObject()
      .put("version", VERSION)
      .put("credentials", array)
      .toString()
  }

  private fun parse(json: String): List<PasskeyCredential> {
    if (json.isBlank()) return emptyList()
    val root = JSONObject(json)
    if (root.optInt("version", 0) != VERSION) {
      throw IllegalArgumentException("Unsupported passkey store version.")
    }
    val array = root.optJSONArray("credentials")
      ?: throw IllegalArgumentException("Passkey store has no credentials array.")
    val byId = LinkedHashMap<String, PasskeyCredential>()
    for (index in 0 until minOf(array.length(), MAX_CREDENTIALS)) {
      val value = array.optJSONObject(index) ?: continue
      val credential = sanitize(PasskeyCredential.fromJson(value)) ?: continue
      byId[credential.credentialId] = credential
    }
    return byId.values.toList()
  }

  private fun write(context: Context, credentials: List<PasskeyCredential>) {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (credentials.isEmpty()) {
      prefs.edit().remove(KEY_PAYLOAD).apply()
      return
    }
    val plain = encode(credentials)
    require(plain.toByteArray(Charsets.UTF_8).size <= MAX_PAYLOAD_BYTES) {
      "Passkey store is too large."
    }
    val encrypted = try {
      encrypt(plain)
    } catch (_: Exception) {
      resetKey()
      encrypt(plain)
    }
    check(prefs.edit().putString(KEY_PAYLOAD, encrypted).commit()) {
      "Could not persist the passkey store."
    }
  }

  private fun encrypt(plainText: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) +
      ":" +
      Base64.encodeToString(
        cipher.doFinal(plainText.toByteArray(Charsets.UTF_8)),
        Base64.NO_WRAP,
      )
  }

  private fun decrypt(payload: String): String {
    val separator = payload.indexOf(':')
    require(separator > 0) { "Malformed passkey store." }
    val iv = Base64.decode(payload.substring(0, separator), Base64.NO_WRAP)
    val ciphertext = Base64.decode(payload.substring(separator + 1), Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateKey(),
      GCMParameterSpec(128, iv),
    )
    return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
    if (existing != null) return existing.secretKey

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    val spec = KeyGenParameterSpec.Builder(
      KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      // Every assertion is already gated by PasskeyActivity's device-auth
      // prompt. Binding this key to a CryptoObject would make it impossible to
      // read the pending queue before the prompt is shown.
      .setUserAuthenticationRequired(false)
      .build()
    generator.init(spec)
    return generator.generateKey()
  }

  private fun resetKey() {
    try {
      val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
      if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
    } catch (_: Exception) {
      // The next write creates a new key.
    }
  }
}
