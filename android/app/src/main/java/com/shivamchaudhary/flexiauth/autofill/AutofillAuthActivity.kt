package com.shivamchaudhary.flexiauth.autofill

import android.app.KeyguardManager
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.view.WindowManager
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Transparent, non-exported activity used as the authentication step of an
 * autofill dataset. Android launches it through the dataset's PendingIntent and
 * only fills the fields when it returns RESULT_OK with a populated dataset.
 *
 * It is intentionally launched without FLAG_ACTIVITY_NEW_TASK so it remains in
 * the caller's task, draws over the app being filled and returns there when it
 * finishes. No "draw over other apps" permission is involved.
 */
class AutofillAuthActivity : FragmentActivity() {
  companion object {
    private const val REQUEST_KEYGUARD = 4201
    const val EXTRA_LOGIN_ID = "login_id"
    const val EXTRA_LOGIN_NAME = "login_name"
    const val EXTRA_USERNAME_ID = "username_id"
    const val EXTRA_PASSWORD_ID = "password_id"

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
          // device has a PIN or pattern. A biometric lockout can also be
          // bypassed with the device credential. Fall back to the keyguard
          // instead of silently cancelling the fill.
          if (
            errorCode == BiometricPrompt.ERROR_NO_BIOMETRICS ||
            errorCode == BiometricPrompt.ERROR_HW_NOT_PRESENT ||
            errorCode == BiometricPrompt.ERROR_HW_UNAVAILABLE ||
            errorCode == BiometricPrompt.ERROR_LOCKOUT ||
            errorCode == BiometricPrompt.ERROR_LOCKOUT_PERMANENT
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
    val login = try {
      id?.let { AutofillCache.find(this, it) }
    } catch (_: Exception) {
      null
    }
    if (login == null) {
      cancel()
      return
    }

    val dataset = try {
      buildAuthenticatedDataset(login)
    } catch (_: Exception) {
      null
    }
    if (dataset == null) {
      cancel()
      return
    }

    finished = true
    // Dataset-level authentication requires the fully populated dataset in the
    // result; RESULT_OK on its own makes Android dismiss the prompt without
    // filling anything.
    setResult(
      RESULT_OK,
      Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset),
    )
    finish()
  }

  private fun buildAuthenticatedDataset(login: AutofillLogin): Dataset? {
    var usernameId = autofillIdExtra(EXTRA_USERNAME_ID)
    var passwordId = autofillIdExtra(EXTRA_PASSWORD_ID)

    // Custom extras normally survive the system's authentication launch. If an
    // OEM strips them, recover the field IDs from the assist structure the
    // platform adds to the intent. Only do this when neither extra is present,
    // so an intentionally absent password field is not filled later.
    if (usernameId == null && passwordId == null) {
      val fields = assistFields()
      usernameId = fields?.usernameId
      passwordId = fields?.passwordId
    }

    val presentation = AutofillPresentation.build(this, login)
    val builder = Dataset.Builder(presentation)
    var values = 0

    if (usernameId != null) {
      val username = login.username?.takeIf { it.isNotBlank() }
      if (username != null) {
        builder.setValue(usernameId, AutofillValue.forText(username), presentation)
        values += 1
      }
    }
    if (passwordId != null) {
      builder.setValue(passwordId, AutofillValue.forText(login.password), presentation)
      values += 1
    }

    return if (values > 0) builder.build() else null
  }

  private fun autofillIdExtra(key: String): AutofillId? {
    val value = intent ?: return null
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      value.getParcelableExtra(key, AutofillId::class.java)
    } else {
      @Suppress("DEPRECATION")
      value.getParcelableExtra(key)
    }
  }

  private fun assistFields(): AutofillFields? {
    val value = intent ?: return null
    val structure = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      value.getParcelableExtra(
        AutofillManager.EXTRA_ASSIST_STRUCTURE,
        AssistStructure::class.java,
      )
    } else {
      @Suppress("DEPRECATION")
      value.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE)
    }
    return try {
      structure?.let { AutofillParser.parse(it) }
    } catch (_: Exception) {
      null
    }
  }

  private fun cancel() {
    if (finished) return
    finished = true
    setResult(RESULT_CANCELED)
    finish()
  }
}
