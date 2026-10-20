package com.shivamchaudhary.flexiauth.crypto

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.Executors

/**
 * Native PBKDF2-HMAC-SHA256 for vault unlock. Hermes' pure-JS PBKDF2 takes
 * seconds at 210k rounds; this runs on a background thread and lets the UI
 * animate the loading state while the derivation completes.
 */
@ReactModule(name = FlexiVaultCryptoModule.NAME)
class FlexiVaultCryptoModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    const val NAME = "FlexiVaultCrypto"
    private const val MAX_ITERATIONS = 2_000_000
    private const val MAX_PASSWORD_BYTES = 4096
    private val executor = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "flexivault-pbkdf2").apply { isDaemon = true }
    }
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun derive(
    password: String,
    saltBase64: String,
    iterations: Int,
    length: Int,
    promise: Promise,
  ) {
    executor.execute {
      try {
        require(iterations in 1..MAX_ITERATIONS) { "Invalid PBKDF2 iteration count." }
        require(length in 32..128) { "Invalid PBKDF2 output length." }
        val salt = Base64.decode(saltBase64, Base64.DEFAULT)
        require(salt.size in 16..64) { "Invalid PBKDF2 salt." }

        val passwordBytes = password.toByteArray(Charsets.UTF_8)
        val output = try {
          require(passwordBytes.size <= MAX_PASSWORD_BYTES) {
            "Password is too long."
          }
          Pbkdf2.derive(passwordBytes, salt, iterations, length)
        } finally {
          passwordBytes.fill(0)
        }
        promise.resolve(Base64.encodeToString(output, Base64.NO_WRAP))
      } catch (error: Throwable) {
        promise.reject("E_PBKDF2", error.message ?: "PBKDF2 failed.", error)
      }
    }
  }
}
