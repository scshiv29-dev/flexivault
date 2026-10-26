package com.shivamchaudhary.flexiauth.autofill

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.Base64

/** Reads the existing encrypted Expo SQLite vault, never writes it or persists
 * the master password/key. A form unlock is scoped to the authentication activity. */
internal object AutofillVaultReader {
  private fun open(context: Context): SQLiteDatabase? {
    // ExpoSQLite.defaultDatabaseDirectory on Android is filesDir/SQLite.
    val file = File(context.filesDir, "SQLite/flexivault.db")
    if (!file.isFile) return null
    return SQLiteDatabase.openDatabase(file.path, null,
      SQLiteDatabase.OPEN_READONLY or SQLiteDatabase.NO_LOCALIZED_COLLATORS)
  }

  private fun meta(db: SQLiteDatabase): Map<String, String> {
    val values = HashMap<String, String>()
    db.rawQuery("SELECT key, value FROM vault_meta", null).use { cursor ->
      while (cursor.moveToNext()) values[cursor.getString(0)] = cursor.getString(1)
    }
    return values
  }

  fun canUnlock(context: Context): Boolean = try {
    open(context)?.use { db ->
      val values = meta(db)
      values["settings.autofillEnabled"] == "1" &&
        !values["vault.kdfSalt"].isNullOrBlank() && !values["vault.keyCheck"].isNullOrBlank()
    } ?: false
  } catch (_: Exception) { false }

  fun autoLockMinutes(context: Context): Int = try {
    open(context)?.use { meta(it)["settings.autoLockMinutes"]?.toIntOrNull() } ?: 5
  } catch (_: Exception) { 5 }

  /** Mirrors the app's biometric-unlock setting; off means master password only. */
  fun biometricsEnabled(context: Context): Boolean = try {
    open(context)?.use { meta(it)["settings.biometricsEnabled"] == "1" } ?: false
  } catch (_: Exception) { false }

  fun matchesVault(context: Context, key: ByteArray): Boolean = try {
    open(context)?.use { db ->
      val expected = Base64.getDecoder().decode(meta(db)["vault.keyCheck"] ?: "")
      expected.isNotEmpty() &&
        MessageDigest.isEqual(expected, MessageDigest.getInstance("SHA-256").digest(key))
    } ?: false
  } catch (_: Exception) { false }

  fun unlock(context: Context, password: String): ByteArray {
    val values = open(context)?.use(::meta) ?: error("No vault exists on this device.")
    check(values["settings.autofillEnabled"] == "1") { "Autofill is disabled." }
    return AutofillUnlockCrypto.derive(password,
      values["vault.kdfSalt"] ?: error("No vault exists on this device."),
      values["vault.kdfIterations"]?.toIntOrNull() ?: 210_000,
      values["vault.keyCheck"] ?: error("The vault could not be verified."))
  }

  fun readLogins(context: Context, key: ByteArray): List<AutofillLogin> {
    return open(context)?.use { db ->
      val values = meta(db)
      check(values["settings.autofillEnabled"] == "1") { "Autofill was disabled." }
      val expected = Base64.getDecoder().decode(values["vault.keyCheck"] ?: "")
      check(MessageDigest.isEqual(expected, MessageDigest.getInstance("SHA-256").digest(key))) {
        "The vault changed. Unlock again."
      }
      val logins = JSONArray()
      db.rawQuery("SELECT data FROM vault_items ORDER BY updated_at DESC LIMIT 5000", null).use { cursor ->
        while (cursor.moveToNext()) {
          val item = JSONObject(AutofillUnlockCrypto.decrypt(key, cursor.getString(0)))
          if (item.optString("type") != "login" || !item.isNull("deletedAt")) continue
          logins.put(JSONObject()
            .put("id", item.optString("id"))
            .put("name", item.optString("name"))
            .put("username", item.opt("username") ?: JSONObject.NULL)
            .put("password", item.optString("password"))
            .put("hosts", item.optJSONArray("urls") ?: JSONArray())
            .put("packages", item.optJSONArray("androidPackages") ?: JSONArray()))
        }
      }
      AutofillCache.parsePayload(JSONObject().put("version", 1).put("logins", logins).toString())
    } ?: emptyList()
  }
}
