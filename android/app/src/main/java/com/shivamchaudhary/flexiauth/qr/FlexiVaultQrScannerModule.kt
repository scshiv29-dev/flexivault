package com.shivamchaudhary.flexiauth.qr

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.integration.android.IntentIntegrator

/**
 * Opens the ZXing capture activity and returns the decoded QR payload.
 *
 * ZXing Android Embedded is Apache-2.0 and runs entirely on-device. It replaces
 * expo-camera's barcode scanner on Android, which bundled proprietary ML Kit.
 *
 * The module also decodes a QR code from an image the user picks from their
 * gallery or screenshots. That path is useful when the only copy of the 2FA
 * setup code is an image on the device.
 */
@ReactModule(name = FlexiVaultQrScannerModule.NAME)
class FlexiVaultQrScannerModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {
  companion object {
    const val NAME = "FlexiVaultQrScanner"

    /** Keep the decoded bitmap small enough to avoid large screenshots OOMing. */
    private const val MAX_IMAGE_DIMENSION = 2048
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

  /**
   * Decodes a QR code from an image URI. Called on a background thread because
   * full-size photos and screenshots can take a moment to decode.
   */
  @ReactMethod
  fun decodeImage(uri: String, promise: Promise) {
    if (uri.isBlank()) {
      promise.reject("qr_image_invalid", "No image was selected.")
      return
    }

    Thread {
      try {
        val contents = decodeQrImage(Uri.parse(uri))
        if (contents.isNullOrBlank()) {
          promise.reject("qr_image_no_code", "No QR code was found in that image.")
        } else {
          promise.resolve(contents)
        }
      } catch (error: Throwable) {
        promise.reject("qr_image_failed", error.message, error)
      }
    }.start()
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

  private fun decodeQrImage(uri: Uri): String? {
    val resolver = reactContext.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { stream ->
      BitmapFactory.decodeStream(stream, null, bounds)
    } ?: return null

    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    val options = BitmapFactory.Options().apply {
      inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight)
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val bitmap = resolver.openInputStream(uri)?.use { stream ->
      BitmapFactory.decodeStream(stream, null, options)
    } ?: return null

    return try {
      decodeBitmap(bitmap)
    } finally {
      bitmap.recycle()
    }
  }

  private fun sampleSize(width: Int, height: Int): Int {
    var sample = 1
    while (maxOf(width, height) / sample > MAX_IMAGE_DIMENSION) {
      sample *= 2
    }
    return sample
  }

  private fun decodeBitmap(bitmap: Bitmap): String? {
    tryDecode(bitmap)?.let { return it }

    // ZXing detects QR codes at any angle, but a manually rotated pass makes
    // screenshots and scans from unusual camera sensors more reliable.
    for (degrees in intArrayOf(90, 180, 270)) {
      val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
      val rotated = Bitmap.createBitmap(
        bitmap,
        0,
        0,
        bitmap.width,
        bitmap.height,
        matrix,
        true,
      )
      val result = try {
        tryDecode(rotated)
      } finally {
        rotated.recycle()
      }
      if (result != null) return result
    }
    return null
  }

  private fun tryDecode(bitmap: Bitmap): String? {
    val width = bitmap.width
    val height = bitmap.height
    if (width <= 0 || height <= 0) return null

    val pixels = IntArray(width * height)
    bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
    val source = RGBLuminanceSource(width, height, pixels)
    val binary = BinaryBitmap(HybridBinarizer(source))
    val hints = mapOf(
      DecodeHintType.TRY_HARDER to true,
      DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
    )

    return try {
      MultiFormatReader().apply { setHints(hints) }.decode(binary).text
    } catch (_: ReaderException) {
      null
    }
  }
}
