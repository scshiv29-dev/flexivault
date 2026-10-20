package com.shivamchaudhary.flexiauth.autofill

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Transparent, non-exported activity used as the authentication step of an
 * autofill dataset. Android launches it through the dataset's PendingIntent and
 * only fills the fields when it returns RESULT_OK.
 */
class AutofillAuthActivity : FragmentActivity() {
  companion object {
    private const val REQUEST_KEYGUARD = 4201
    const val EXTRA_LOGIN_ID = "login_id"
    const val EXTRA_LOGIN_NAME = "login_name"

    fun canAuthenticate(context: Context): Boolean {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val manager = BiometricManager.from(context)
        val biometrics = manager.canAuthenticate(
          BiometricManager.Authenticators.BIOMETRIC_STRONG
        ) == BiometricManager.BIOMETRIC_SUCCESS
        val credential = manager.canAuthenticate(
          BiometricManager.Authenticators.DEVICE_CREDENTIAL
        ) == BiometricManager.BIOMETRIC_SUCCESS
        return biometrics || credential
      }
      val keyguard = context.getSystemService(KeyguardManager::class.java)
      return keyguard?.isDeviceSecure == true
    }
  }

  private var finished = false
  private var promptSubtitle = "Confirm to fill this login"
  private var loginId: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    setFinishOnTouchOutside(false)

    loginId = intent?.getStringExtra(EXTRA_LOGIN_ID)
    val loginName = intent?.getStringExtra(EXTRA_LOGIN_NAME)
      ?.trim()
      ?.take(80)
      ?.takeIf { it.isNotEmpty() }
    if (loginName != null) {
      promptSubtitle = "Fill $loginName"
    }

    if (savedInstanceState != null) {
      cancel()
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (canUseBiometrics()) {
        promptBiometric()
      } else {
        promptDeviceCredential()
      }
    } else {
      promptDeviceCredential()
    }
  }

  private fun canUseBiometrics(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
    return BiometricManager.from(this).canAuthenticate(
      BiometricManager.Authenticators.BIOMETRIC_STRONG
    ) == BiometricManager.BIOMETRIC_SUCCESS
  }

  private fun promptBiometric() {
    val executor = ContextCompat.getMainExecutor(this)
    val prompt = BiometricPrompt(
      this,
      executor,
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          succeed()
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          // Some OEMs report no usable biometric hardware even though the
          // device has a PIN or pattern. Fall back to the keyguard instead of
          // silently cancelling the fill.
          if (
            errorCode == BiometricPrompt.ERROR_NO_BIOMETRICS ||
            errorCode == BiometricPrompt.ERROR_HW_NOT_PRESENT ||
            errorCode == BiometricPrompt.ERROR_HW_UNAVAILABLE
          ) {
            promptDeviceCredential()
          } else {
            cancel()
          }
        }
      },
    )

    val info = BiometricPrompt.PromptInfo.Builder()
      .setTitle("Unlock FlexiVault")
      .setSubtitle(promptSubtitle)
      .setAllowedAuthenticators(
        BiometricManager.Authenticators.BIOMETRIC_STRONG or
          BiometricManager.Authenticators.DEVICE_CREDENTIAL
      )
      .build()

    prompt.authenticate(info)
  }

  private fun promptDeviceCredential() {
    val keyguard = getSystemService(KeyguardManager::class.java)
    if (keyguard == null || !keyguard.isDeviceSecure) {
      cancel()
      return
    }

    val intent = keyguard.createConfirmDeviceCredentialIntent(
      "Unlock FlexiVault",
      promptSubtitle,
    )
    if (intent == null) {
      cancel()
      return
    }
    startActivityForResult(intent, REQUEST_KEYGUARD)
  }

  @Deprecated("Deprecated in the Android SDK, but the result still arrives here.")
  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != REQUEST_KEYGUARD) return
    if (resultCode == RESULT_OK) succeed() else cancel()
  }

  @Deprecated("Deprecated in the Android SDK.")
  override fun onBackPressed() {
    cancel()
  }

  private fun succeed() {
    if (finished) return

    // A lock, reset, expiry or settings change may have cleared the cache while
    // the prompt was open. Do not complete a stale dataset in that case.
    val id = loginId
    val stillCached = try {
      id != null && AutofillCache.contains(this, id)
    } catch (_: Exception) {
      false
    }
    if (!stillCached) {
      cancel()
      return
    }

    finished = true
    setResult(RESULT_OK)
    finish()
  }

  private fun cancel() {
    if (finished) return
    finished = true
    setResult(RESULT_CANCELED)
    finish()
  }
}
