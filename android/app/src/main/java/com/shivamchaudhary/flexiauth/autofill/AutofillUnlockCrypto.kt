package com.shivamchaudhary.flexiauth.autofill

import com.shivamchaudhary.flexiauth.crypto.Pbkdf2
import java.security.MessageDigest
import java.text.Normalizer
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Mirrors lib/vault/crypto.ts; kept Android-free for cross-client JVM vectors. */
internal object AutofillUnlockCrypto {
  fun derive(password: String, salt: String, iterations: Int, check: String): ByteArray {
    require(password.isNotEmpty() && password.length <= 4096) { "Enter your master password." }
    require(iterations in 1..2_000_000) { "The vault KDF settings are invalid." }
    val saltBytes = Base64.getDecoder().decode(salt)
    require(saltBytes.size >= 16) { "The vault salt is invalid." }
    val bytes = Normalizer.normalize(password, Normalizer.Form.NFKC).toByteArray(Charsets.UTF_8)
    val key = try { Pbkdf2.derive(bytes, saltBytes, iterations, 32) } finally { bytes.fill(0) }
    val actual = MessageDigest.getInstance("SHA-256").digest(key)
    val expected = try { Base64.getDecoder().decode(check) } catch (_: Exception) { byteArrayOf() }
    if (!MessageDigest.isEqual(actual, expected)) {
      key.fill(0)
      throw IllegalArgumentException("That master password is incorrect.")
    }
    return key
  }

  fun decrypt(key: ByteArray, envelope: String): String {
    val parts = envelope.split('.')
    require(parts.size == 3 && parts[0] == "v1") { "Unsupported encrypted payload." }
    val iv = Base64.getDecoder().decode(parts[1])
    require(iv.size == 12) { "Invalid encrypted payload." }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
    val plaintext = cipher.doFinal(Base64.getDecoder().decode(parts[2]))
    return try { String(plaintext, Charsets.UTF_8) } finally { plaintext.fill(0) }
  }
}
