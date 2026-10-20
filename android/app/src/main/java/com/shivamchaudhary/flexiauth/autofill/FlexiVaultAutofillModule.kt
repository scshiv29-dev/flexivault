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
    Thread {
      try {
        AutofillCache.write(reactContext, payload)
        promise.resolve(null)
      } catch (exception: Exception) {
        promise.reject("autofill_cache_failed", exception.message, exception)
      }
    }.start()
  }

  @ReactMethod
  fun clear(promise: Promise) {
    try {
      AutofillCache.clear(reactContext)
      promise.resolve(null)
    } catch (exception: Exception) {
      promise.reject("autofill_clear_failed", exception.message, exception)
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
