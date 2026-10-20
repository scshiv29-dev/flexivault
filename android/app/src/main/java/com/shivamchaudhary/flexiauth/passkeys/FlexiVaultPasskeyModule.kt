package com.shivamchaudhary.flexiauth.passkeys

import android.content.Intent
import android.os.Build
import android.provider.Settings
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

  @ReactMethod
  fun openSettings(promise: Promise) {
    try {
      val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        Intent(Settings.ACTION_CREDENTIAL_PROVIDER)
      } else {
        Intent(Settings.ACTION_SETTINGS)
      }.apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactContext.startActivity(intent)
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("passkey_settings_failed", exception.message, exception)
    }
  }
}
