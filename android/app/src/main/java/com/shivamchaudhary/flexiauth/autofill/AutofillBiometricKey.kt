package com.shivamchaudhary.flexiauth.autofill

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import androidx.biometric.BiometricManager
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource

/**
 * Biometric unlock for the locked-form overlay.
 *
 * When the user turns on biometric unlock in the app, the vault key is
 * encrypted to the public half of a Keystore RSA key whose private half needs
 * a fresh strong-biometric (or, on Android 11+, device-credential) check for
 * every use. Wrapping needs no prompt, so the app can refresh it on each
 * unlock; unwrapping only happens inside a BiometricPrompt CryptoObject.
 * Enrolling a new fingerprint or face invalidates the key, which falls back to
 * the master password until the app is unlocked again.
 */
internal object AutofillBiometricKey {
  private const val ALIAS = "flexivault_autofill_biometric_v1"
  private const val PREFS = "flexivault_autofill_biometric"
  private const val BLOB = "wrapped_key"
  private const val TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
  // Android Keystore only supports SHA-1 for the MGF1 digest on many devices.
  private val OAEP = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1,
    PSource.PSpecified.DEFAULT)

  fun authenticators(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      BiometricManager.Authenticators.BIOMETRIC_STRONG or
        BiometricManager.Authenticators.DEVICE_CREDENTIAL
    } else {
      BiometricManager.Authenticators.BIOMETRIC_STRONG
    }

  /** True when the user can pass the prompt this key requires. */
  fun canPrompt(context: Context): Boolean =
    BiometricManager.from(context).canAuthenticate(authenticators()) ==
      BiometricManager.BIOMETRIC_SUCCESS

  private fun keyStore(): KeyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun has(context: Context): Boolean = try {
    prefs(context).getString(BLOB, null) != null && keyStore().containsAlias(ALIAS)
  } catch (_: Exception) { false }

  private fun generate() {
    val builder = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_DECRYPT)
      .setKeySize(2048)
      .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
      .setUserAuthenticationRequired(true)
      .setInvalidatedByBiometricEnrollment(true)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      builder.setUserAuthenticationParameters(0,
        KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
    }
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore").apply {
      initialize(builder.build())
      generateKeyPair()
    }
  }

  /** Wraps the 32-byte vault key. Never prompts; never stores the raw key. */
  @Synchronized fun store(context: Context, rawKey: ByteArray) {
    require(rawKey.size == 32) { "Invalid vault key." }
    val store = keyStore()
    if (!store.containsAlias(ALIAS)) generate()
    // Use a plain copy of the public key so encryption is not subject to the
    // Keystore's user-authentication requirement.
    val certificate = store.getCertificate(ALIAS) ?: error("Biometric key is unavailable.")
    val publicKey = KeyFactory.getInstance(certificate.publicKey.algorithm)
      .generatePublic(X509EncodedKeySpec(certificate.publicKey.encoded))
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, publicKey, OAEP)
    val wrapped = cipher.doFinal(rawKey)
    prefs(context).edit().putString(BLOB, Base64.getEncoder().encodeToString(wrapped)).commit()
  }

  @Synchronized fun clear(context: Context) {
    prefs(context).edit().clear().commit()
    try { keyStore().deleteEntry(ALIAS) } catch (_: Exception) {}
  }

  /** A decrypt cipher for BiometricPrompt, or null if biometrics changed. */
  fun decryptCipher(context: Context): Cipher? {
    if (!has(context)) return null
    return try {
      val key = keyStore().getKey(ALIAS, null) as? PrivateKey ?: return null
      Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, key, OAEP) }
    } catch (_: KeyPermanentlyInvalidatedException) {
      clear(context)
      null
    } catch (_: Exception) {
      null
    }
  }

  /** Call only with the cipher BiometricPrompt returned after success. */
  fun unwrap(context: Context, authenticated: Cipher): ByteArray {
    val blob = prefs(context).getString(BLOB, null) ?: error("Biometric unlock is not set up.")
    val key = authenticated.doFinal(Base64.getDecoder().decode(blob))
    check(key.size == 32) { key.fill(0); "Biometric unlock is damaged." }
    return key
  }
}
