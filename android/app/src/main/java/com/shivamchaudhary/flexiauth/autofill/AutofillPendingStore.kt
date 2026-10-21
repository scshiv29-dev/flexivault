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

/**
 * Credentials confirmed in [AutofillSaveActivity] but not yet written to the
 * encrypted vault. The vault key only exists inside the React Native process,
 * so the autofill service cannot update the vault directly. Instead it stores a
 * short-lived, Keystore-encrypted queue; the unlocked app imports it and clears
 * the queue after the encrypted rows are persisted.
 *
 * Pending rows are also overlaid on the read-only autofill cache, so a login
 * saved on a website is available to the next fill even before the app has been
 * opened again.
 */
data class AutofillPendingSave(
  val itemId: String,
  val mode: String,
  val name: String,
  val username: String?,
  val password: String,
  val hosts: List<String>,
  val packages: List<String>,
  val createdAt: Long,
)

object AutofillPendingStore {
  private const val PREFS = "flexivault_autofill_pending"
  private const val KEY_PAYLOAD = "payload"
  private const val KEY_ALIAS = "flexivault.autofill.pending.v1"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val TTL_MS = 90L * 24L * 60L * 60L * 1000L
  private const val MAX_SAVES = 100
  private const val MAX_PAYLOAD_BYTES = 512 * 1024
  private val PACKAGE_PATTERN =
    Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$")

  @Synchronized
  fun add(context: Context, save: AutofillPendingSave): Boolean {
    val sanitized = sanitize(save) ?: return false
    return try {
      val current = read(context)
        .filterNot { it.itemId == sanitized.itemId }
        .toMutableList()
      current.add(sanitized)
      while (current.size > MAX_SAVES) current.removeAt(0)
      write(context, current)
      true
    } catch (_: Exception) {
      false
    }
  }

  @Synchronized
  fun read(context: Context): List<AutofillPendingSave> {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val payload = prefs.getString(KEY_PAYLOAD, null) ?: return emptyList()
    return try {
      val saves = parse(decrypt(payload))
      val now = System.currentTimeMillis()
      val fresh = saves.filter { now - it.createdAt <= TTL_MS }
      if (fresh.size != saves.size) write(context, fresh)
      fresh
    } catch (_: Exception) {
      clear(context)
      emptyList()
    }
  }

  fun readJson(context: Context): String = encode(read(context))

  @Synchronized
  fun clear(context: Context, ids: Set<String>? = null) {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (ids == null) {
      check(prefs.edit().remove(KEY_PAYLOAD).commit()) {
        "Could not clear the autofill pending queue."
      }
      return
    }
    try {
      val remaining = read(context).filterNot { it.itemId in ids }
      if (remaining.isEmpty()) {
        prefs.edit().remove(KEY_PAYLOAD).apply()
      } else {
        write(context, remaining)
      }
    } catch (_: Exception) {
      prefs.edit().remove(KEY_PAYLOAD).apply()
    }
  }

  /**
   * Applies queued creates and updates to the read-only cache. This is a
   * best-effort overlay: if the queue cannot be decrypted, the cache still works.
   */
  fun apply(context: Context, logins: List<AutofillLogin>): List<AutofillLogin> {
    val pending = try {
      read(context)
    } catch (_: Exception) {
      return logins
    }
    if (pending.isEmpty()) return logins

    val byId = LinkedHashMap<String, AutofillLogin>()
    for (login in logins) byId[login.id] = login
    for (save in pending) {
      val existing = byId[save.itemId]
      if (existing != null) {
        byId[save.itemId] = existing.copy(
          name = save.name.ifBlank { existing.name },
          username = save.username ?: existing.username,
          password = save.password,
          hosts = (existing.hosts + save.hosts).distinct(),
          packages = (existing.packages + save.packages).distinct(),
        )
      } else {
        byId[save.itemId] = AutofillLogin(
          id = save.itemId,
          name = save.name,
          username = save.username,
          password = save.password,
          hosts = save.hosts,
          packages = save.packages,
        )
      }
    }
    return byId.values.toList()
  }

  private fun sanitize(save: AutofillPendingSave): AutofillPendingSave? {
    val itemId = save.itemId.trim().take(120)
    val name = save.name.trim().take(200)
    val password = save.password.take(4096)
    if (itemId.isEmpty() || name.isEmpty() || password.isEmpty()) return null
    return AutofillPendingSave(
      itemId = itemId,
      mode = if (save.mode == "update") "update" else "create",
      name = name,
      username = save.username?.trim()?.take(500)?.ifEmpty { null },
      password = password,
      hosts = save.hosts.mapNotNull(::normaliseHost).distinct().take(20),
      packages = save.packages
        .map { it.trim() }
        .filter { PACKAGE_PATTERN.matches(it) }
        .distinct()
        .take(20),
      createdAt = if (save.createdAt > 0L) save.createdAt else System.currentTimeMillis(),
    )
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

  private fun write(context: Context, saves: List<AutofillPendingSave>) {
    val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (saves.isEmpty()) {
      prefs.edit().remove(KEY_PAYLOAD).apply()
      return
    }
    val plain = encode(saves)
    require(plain.toByteArray(Charsets.UTF_8).size <= MAX_PAYLOAD_BYTES) {
      "Autofill pending queue is too large."
    }
    val encrypted = try {
      encrypt(plain)
    } catch (_: Exception) {
      resetKey()
      encrypt(plain)
    }
    check(prefs.edit().putString(KEY_PAYLOAD, encrypted).commit()) {
      "Could not persist the autofill pending queue."
    }
  }

  private fun encode(saves: List<AutofillPendingSave>): String {
    val root = JSONObject().put("version", 1)
    val array = JSONArray()
    for (save in saves) {
      array.put(
        JSONObject()
          .put("itemId", save.itemId)
          .put("mode", save.mode)
          .put("name", save.name)
          .put("username", save.username ?: JSONObject.NULL)
          .put("password", save.password)
          .put("hosts", JSONArray(save.hosts))
          .put("packages", JSONArray(save.packages))
          .put("createdAt", save.createdAt)
      )
    }
    return root.put("saves", array).toString()
  }

  private fun parse(json: String): List<AutofillPendingSave> {
    val root = JSONObject(json)
    if (root.optInt("version", 0) != 1) {
      throw IllegalArgumentException("Unsupported autofill pending version.")
    }
    val array = root.optJSONArray("saves")
      ?: throw IllegalArgumentException("Autofill pending queue has no saves array.")
    val result = ArrayList<AutofillPendingSave>()
    for (index in 0 until minOf(array.length(), MAX_SAVES)) {
      val value = array.optJSONObject(index) ?: continue
      val save = sanitize(
        AutofillPendingSave(
          itemId = value.optString("itemId"),
          mode = value.optString("mode", "create"),
          name = value.optString("name"),
          username = value.opt("username")?.takeUnless { it == JSONObject.NULL }?.toString(),
          password = value.optString("password"),
          hosts = stringList(value.optJSONArray("hosts")),
          packages = stringList(value.optJSONArray("packages")),
          createdAt = value.optLong("createdAt", 0L),
        )
      ) ?: continue
      result.add(save)
    }
    return result
  }

  private fun stringList(array: JSONArray?): List<String> {
    if (array == null) return emptyList()
    val result = ArrayList<String>()
    for (index in 0 until minOf(array.length(), 20)) {
      val value = array.optString(index).trim()
      if (value.isNotEmpty() && value.length <= 255) result.add(value)
    }
    return result
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
    require(separator > 0) { "Malformed autofill pending queue." }
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
      // The next write creates a fresh key.
    }
  }
}
