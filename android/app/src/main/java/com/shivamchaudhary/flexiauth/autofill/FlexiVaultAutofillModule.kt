package com.shivamchaudhary.flexiauth.autofill

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.autofill.AutofillManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = FlexiVaultAutofillModule.NAME)
class FlexiVaultAutofillModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    const val NAME = "FlexiVaultAutofill"
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
  }

  @ReactMethod
  fun isEnabled(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(false)
      return
    }
    try {
      val selected = Settings.Secure.getString(
        reactContext.contentResolver,
        "autofill_service",
      )
      if (!selected.isNullOrBlank()) {
        val component = ComponentName(
          reactContext,
          FlexiVaultAutofillService::class.java,
        )
        promise.resolve(
          selected == component.flattenToString() ||
            selected == component.flattenToShortString()
        )
        return
      }
      val manager = reactContext.getSystemService(AutofillManager::class.java)
      promise.resolve(manager?.hasEnabledAutofillServices() == true)
    } catch (exception: Exception) {
      promise.reject("autofill_status_failed", exception.message, exception)
    }
  }

  @ReactMethod
  fun configure(payload: String, promise: Promise) {
    val epoch = AutofillSession.epoch()
    Thread {
      try {
        AutofillSession.configure(epoch, AutofillVaultReader.autoLockMinutes(reactContext)) {
          AutofillCache.write(reactContext, payload)
        }
        promise.resolve(null)
      } catch (exception: Exception) {
        promise.reject("autofill_cache_failed", exception.message, exception)
      }
    }.start()
  }

  /**
   * Wraps the vault key for fingerprint/face unlock of locked forms. Only the
   * app calls this, while unlocked and with biometric unlock turned on.
   */
  @ReactMethod
  fun setBiometricUnlockKey(keyB64: String, promise: Promise) {
    Thread {
      val key = try { java.util.Base64.getDecoder().decode(keyB64) } catch (_: Exception) { null }
      try {
        requireNotNull(key) { "Invalid vault key." }
        AutofillBiometricKey.store(reactContext, key)
        promise.resolve(null)
      } catch (exception: Exception) {
        promise.reject("autofill_biometric_failed", exception.message, exception)
      } finally {
        key?.fill(0)
      }
    }.start()
  }

  @ReactMethod
  fun clearBiometricUnlockKey(promise: Promise) {
    try {
      AutofillBiometricKey.clear(reactContext)
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("autofill_biometric_failed", exception.message, exception)
    }
  }

  @ReactMethod
  fun lock(promise: Promise) {
    AutofillSession.lock()
    promise.resolve(null)
  }

  @ReactMethod
  fun clear(promise: Promise) {
    try {
      AutofillSession.lock()
      AutofillCache.clear(reactContext)
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("autofill_clear_failed", exception.message, exception)
    }
  }

  /**
   * Returns the Keystore-encrypted credentials confirmed by the save overlay.
   * The JavaScript vault imports them only while unlocked.
   */
  @ReactMethod
  fun readPendingSaves(promise: Promise) {
    Thread {
      try {
        promise.resolve(AutofillPendingStore.readJson(reactContext))
      } catch (exception: Exception) {
        promise.reject("autofill_pending_read_failed", exception.message, exception)
      }
    }.start()
  }

  @ReactMethod
  fun clearAllPendingSaves(promise: Promise) {
    try {
      AutofillPendingStore.clear(reactContext)
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("autofill_pending_clear_failed", exception.message, exception)
    }
  }

  @ReactMethod
  fun clearPendingSaves(ids: ReadableArray, promise: Promise) {
    try {
      val selected = HashSet<String>()
      for (index in 0 until ids.size()) {
        ids.getString(index)?.let { selected.add(it) }
      }
      if (selected.isNotEmpty()) {
        AutofillPendingStore.clear(reactContext, selected)
      }
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("autofill_pending_clear_failed", exception.message, exception)
    }
  }

  @ReactMethod
  fun openSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      if (intent.resolveActivity(reactContext.packageManager) == null) {
        intent.action = Settings.ACTION_SETTINGS
        intent.data = null
      }
      reactContext.startActivity(intent)
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("autofill_settings_failed", exception.message, exception)
    }
  }
}
