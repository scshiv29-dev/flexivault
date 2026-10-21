package com.shivamchaudhary.flexiauth.passkeys

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = FlexiVaultPasskeyModule.NAME)
class FlexiVaultPasskeyModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    const val NAME = "FlexiVaultPasskeys"
    private const val EMPTY_STORE = "{\"version\":1,\"credentials\":[]}"
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  }

  /**
   * Android has no public query for "is my provider enabled"; the selector is a
   * user-controlled system setting. The JS UI uses this to decide whether to
   * show the Android 14+ setup row, and opens the official settings screen.
   */
  @ReactMethod
  fun isEnabled(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
  }

  @ReactMethod
  fun readPendingPasskeys(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      promise.resolve(EMPTY_STORE)
      return
    }
    Thread {
      try {
        promise.resolve(PasskeyStore.readPendingJson(reactContext))
      } catch (exception: Exception) {
        promise.reject("passkey_pending_read_failed", exception.message, exception)
      }
    }.start()
  }

  @ReactMethod
  fun clearPendingPasskeys(ids: ReadableArray, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      promise.resolve(null)
      return
    }
    try {
      val selected = HashSet<String>()
      for (index in 0 until ids.size()) {
        ids.getString(index)?.let { selected.add(it) }
      }
      if (selected.isNotEmpty()) PasskeyStore.clearPending(reactContext, selected)
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("passkey_pending_clear_failed", exception.message, exception)
    }
  }

  @ReactMethod
  fun syncPasskeys(payload: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      promise.resolve(null)
      return
    }
    Thread {
      try {
        PasskeyStore.sync(reactContext, payload)
        promise.resolve(null)
      } catch (exception: Exception) {
        promise.reject("passkey_sync_failed", exception.message, exception)
      }
    }.start()
  }

  @ReactMethod
  fun clear(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      promise.resolve(null)
      return
    }
    try {
      PasskeyStore.clear(reactContext)
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("passkey_clear_failed", exception.message, exception)
    }
  }

  /**
   * Opens the system passkey-provider picker when the device exposes it.
   *
   * Android 15's ACTION_CREDENTIAL_PROVIDER requires a package: data URI. Some
   * Android 14 builds, and some OEM Settings apps, do not implement that action
   * at all. In that case fall back to Security settings and show navigation
   * guidance instead of crashing with ActivityNotFoundException.
   */
  @ReactMethod
  fun openSettings(promise: Promise) {
    try {
      val packageUri = Uri.parse("package:${reactContext.packageName}")
      val candidates = ArrayList<Intent>()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        candidates.add(Intent(Settings.ACTION_CREDENTIAL_PROVIDER).setData(packageUri))
      }
      candidates.add(Intent(Settings.ACTION_SECURITY_SETTINGS))
      candidates.add(Intent(Settings.ACTION_SETTINGS))

      var lastError: Exception? = null
      for (intent in candidates) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(reactContext.packageManager) == null) continue
        try {
          reactContext.startActivity(intent)
          if (intent.action != Settings.ACTION_CREDENTIAL_PROVIDER) {
            reactContext.runOnUiQueueThread {
              Toast.makeText(
                reactContext,
                "Open Settings > Security & privacy > Passwords, passkeys & autofill, then choose FlexiVault.",
                Toast.LENGTH_LONG,
              ).show()
            }
          }
          promise.resolve(null)
          return
        } catch (exception: Exception) {
          lastError = exception
        }
      }

      if (lastError != null) {
        promise.reject("passkey_settings_failed", lastError.message, lastError)
      } else {
        promise.reject(
          "passkey_settings_failed",
          "No Android settings screen is available on this device.",
        )
      }
    } catch (exception: Exception) {
      promise.reject("passkey_settings_failed", exception.message, exception)
    }
  }
}
