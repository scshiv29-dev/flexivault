package com.shivamchaudhary.flexiauth.qr

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.google.zxing.integration.android.IntentIntegrator

/**
 * Opens the ZXing capture activity and returns the decoded QR payload.
 *
 * ZXing Android Embedded is Apache-2.0 and runs entirely on-device. It replaces
 * expo-camera's barcode scanner on Android, which bundled proprietary ML Kit.
 */
@ReactModule(name = FlexiVaultQrScannerModule.NAME)
class FlexiVaultQrScannerModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {
  companion object {
    const val NAME = "FlexiVaultQrScanner"
  }

  private var pendingPromise: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun scan(promise: Promise) {
    if (pendingPromise != null) {
      promise.reject("qr_scanner_busy", "A QR scanner is already open.")
      return
    }

    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("qr_scanner_unavailable", "No foreground activity is available.")
      return
    }

    pendingPromise = promise
    try {
      val intent = IntentIntegrator(activity)
        .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
        .setPrompt("Scan an authenticator QR code")
        .setBeepEnabled(false)
        .setOrientationLocked(false)
        .createScanIntent()
      activity.startActivityForResult(intent, IntentIntegrator.REQUEST_CODE)
    } catch (exception: Exception) {
      pendingPromise = null
      promise.reject("qr_scanner_failed", exception.message, exception)
    }
  }

  override fun onActivityResult(
    activity: Activity,
    requestCode: Int,
    resultCode: Int,
    data: Intent?,
  ) {
    if (requestCode != IntentIntegrator.REQUEST_CODE) return
    val promise = pendingPromise ?: return
    pendingPromise = null

    try {
      if (resultCode != Activity.RESULT_OK) {
        promise.resolve(null)
        return
      }
      val result = IntentIntegrator.parseActivityResult(resultCode, data)
      promise.resolve(result?.contents)
    } catch (exception: Exception) {
      promise.reject("qr_scanner_result_failed", exception.message, exception)
    }
  }

  override fun onNewIntent(intent: Intent) {
    // CaptureActivity owns the scanner lifecycle; no new intent is needed here.
  }

  override fun invalidate() {
    pendingPromise?.resolve(null)
    pendingPromise = null
    reactContext.removeActivityEventListener(this)
    super.invalidate()
  }
}
