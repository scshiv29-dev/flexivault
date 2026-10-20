package com.shivamchaudhary.flexiauth.autofill

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class AutofillLogin(
  val id: String,
  val name: String,
  val username: String?,
  val password: String,
  val hosts: List<String>,
  val packages: List<String>,
)

/**
 * Stores a login-only autofill cache encrypted with a key that never leaves the
 * Android Keystore. The cache survives app locks and device reboots, and expires
 * after 30 days. It is cleared when autofill is disabled or the vault is reset.
 *
 * The cache is decrypted by the autofill service, but no dataset is returned
 * without [AutofillAuthActivity] completing a device authentication prompt.
 */
object AutofillCache {
  private const val PREFS = "flexivault_autofill"
  private const val KEY_PAYLOAD = "payload"
  private const val KEY_CREATED_AT = "createdAt"
  private const val KEY_CREATED_ELAPSED = "createdElapsed"
  private const val KEY_ALIAS = "flexivault.autofill.v1"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val TTL_MS = 30L * 24L * 60L * 60L * 1000L
  private const val CLOCK_SKEW_MS = 10L * 60L * 1000L
  private const val MAX_LOGINS = 5000
  private const val MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
  private val PACKAGE_PATTERN =
    Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")

  @Synchronized
  fun write(context: Context, json: String) {
    require(json.toByteArray(Charsets.UTF_8).size <= MAX_PAYLOAD_BYTES) {
      "Autofill cache is too large."
    }

    val logins = parsePayload(json)
    if (logins.isEmpty()) {
      clear(context)
      return
    }

    val sanitized = encode(logins)
    val encrypted = try {
      encrypt(sanitized)
    } catch (_: Exception) {
      // A key can be invalidated by a lock-screen change or a restored backup.
      // Create a fresh key once; the data is only a cache.
      resetKey()
      encrypt(sanitized)
    }

    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val stored = prefs.edit()
      .putString(KEY_PAYLOAD, encrypted)
      .putLong(KEY_CREATED_AT, System.currentTimeMillis())
      .remove(KEY_CREATED_ELAPSED)
      .commit()
    check(stored) { "Could not persist the autofill cache." }
  }

  @Synchronized
  fun read(context: Context): List<AutofillLogin> {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val payload = prefs.getString(KEY_PAYLOAD, null) ?: return emptyList()

    // The previous cache used elapsedRealtime(), which made every reboot look
    // like an expired cache. Adopt existing payloads once, then use wall time.
    var createdAt = prefs.getLong(KEY_CREATED_AT, -1L)
    if (createdAt <= 0L) {
      val legacy = prefs.getLong(KEY_CREATED_ELAPSED, -1L)
      if (legacy >= 0L) {
        createdAt = System.currentTimeMillis()
        prefs.edit()
          .putLong(KEY_CREATED_AT, createdAt)
          .remove(KEY_CREATED_ELAPSED)
          .apply()
      }
    }

    val now = System.currentTimeMillis()
    if (
      createdAt <= 0L ||
      now + CLOCK_SKEW_MS < createdAt ||
      now - createdAt > TTL_MS
    ) {
      clear(context)
      return emptyList()
    }

    return try {
      val logins = parsePayload(decrypt(payload))
      if (logins.isEmpty()) clear(context)
      logins
    } catch (_: Exception) {
      clear(context)
      emptyList()
    }
  }

  fun contains(context: Context, id: String): Boolean {
    return read(context).any { login -> login.id == id }
  }

  @Synchronized
  fun clear(context: Context) {
    context.applicationContext
      .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .remove(KEY_PAYLOAD)
      .remove(KEY_CREATED_AT)
      .remove(KEY_CREATED_ELAPSED)
      .apply()
  }

  private fun encode(logins: List<AutofillLogin>): String {
    val root = JSONObject().put("version", 1)
    val array = JSONArray()
    for (login in logins) {
      array.put(
        JSONObject()
          .put("id", login.id)
          .put("name", login.name)
          .put("username", login.username ?: JSONObject.NULL)
          .put("password", login.password)
          .put("hosts", JSONArray(login.hosts))
          .put("packages", JSONArray(login.packages))
      )
    }
    return root.put("logins", array).toString()
  }

  private fun parsePayload(json: String): List<AutofillLogin> {
    val root = JSONObject(json)
    if (root.optInt("version", 0) != 1) {
      throw IllegalArgumentException("Unsupported autofill cache version.")
    }
    val array = root.optJSONArray("logins")
      ?: throw IllegalArgumentException("Autofill cache has no logins array.")
    if (array.length() > MAX_LOGINS) {
      throw IllegalArgumentException("Too many logins for the autofill cache.")
    }

    val result = ArrayList<AutofillLogin>()
    for (index in 0 until array.length()) {
      val objectValue = array.optJSONObject(index) ?: continue
      val id = objectValue.optString("id").trim().take(120)
      val name = objectValue.optString("name").trim().take(200)
      val usernameValue = objectValue.opt("username")
      val username = if (usernameValue == null || usernameValue == JSONObject.NULL) {
        null
      } else {
        usernameValue.toString().trim().take(500).ifEmpty { null }
      }
      val password = objectValue.optString("password")
      if (id.isEmpty() || name.isEmpty() || password.isEmpty() || password.length > 4096) {
        continue
      }

      val hosts = stringList(objectValue.optJSONArray("hosts"), 20, 255)
        .mapNotNull(::normaliseHost)
        .filter { it == "localhost" || it.contains('.') }
        .distinct()
      val packages = stringList(objectValue.optJSONArray("packages"), 20, 200)
        .filter { PACKAGE_PATTERN.matches(it) }
        .distinct()

      if (hosts.isEmpty() && packages.isEmpty()) continue
      result.add(AutofillLogin(id, name, username, password, hosts, packages))
    }
    return result
  }

  private fun stringList(array: JSONArray?, maxItems: Int, maxLength: Int): List<String> {
    if (array == null) return emptyList()
    val result = ArrayList<String>()
    val limit = minOf(array.length(), maxItems)
    for (index in 0 until limit) {
      val value = array.optString(index).trim()
      if (value.isNotEmpty() && value.length <= maxLength) result.add(value)
    }
    return result
  }

  private fun normaliseHost(value: String): String? {
    var host = value.trim().lowercase()
    host = host.removePrefix("https://").removePrefix("http://")
    host = host.substringBefore('/').substringBefore('?').substringBefore('#')
    host = host.substringAfterLast('@')
    host = if (host.startsWith("[")) {
      val end = host.indexOf(']')
      if (end > 1) host.substring(1, end) else ""
    } else {
      host.substringBefore(':')
    }
    host = host.trimEnd('.').removePrefix("www.")
    return host.ifEmpty { null }
  }

  private fun encrypt(plainText: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val iv = cipher.iv
    val ciphertext = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
    return Base64.encodeToString(iv, Base64.NO_WRAP) +
      ":" +
      Base64.encodeToString(ciphertext, Base64.NO_WRAP)
  }

  private fun decrypt(payload: String): String {
    val separator = payload.indexOf(':')
    require(separator > 0) { "Malformed autofill cache." }
    val iv = Base64.decode(payload.substring(0, separator), Base64.NO_WRAP)
    val ciphertext = Base64.decode(payload.substring(separator + 1), Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(
      Cipher.DECRYPT_MODE,
      getOrCreateKey(),
      GCMParameterSpec(128, iv)
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
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256)
      // We intentionally do not bind the key to a biometric CryptoObject.
      // The service gates every fill behind AutofillAuthActivity; binding the
      // key would require passing a CryptoObject across processes.
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
      // Nothing else can be done; the next write will create a new key.
    }
  }
}
