package com.shivamchaudhary.flexiauth.autofill

import android.app.KeyguardManager
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.service.autofill.Dataset
import android.view.WindowManager
import android.view.Gravity
import android.view.ViewGroup
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.view.autofill.AutofillId
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.shivamchaudhary.flexiauth.R

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
    const val EXTRA_WEB_DOMAIN = "web_domain"
    const val EXTRA_TARGET_PACKAGE = "target_package"
    const val EXTRA_UNLOCK = "unlock_vault"

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

  @Volatile private var finished = false
  private var promptSubtitle = "Confirm to fill this login"
  private var loginId: String? = null
  private var expectedWebDomain: String? = null
  private var expectedPackage: String? = null
  private var needsUnlock = false
  private var vaultKey: ByteArray? = null
  private var epoch = 0L
  private var busy = false
  private var deviceAuthenticated = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    setFinishOnTouchOutside(false)
    window.decorView.filterTouchesWhenObscured = true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) window.setHideOverlayWindows(true)
    epoch = AutofillSession.epoch()
    needsUnlock = intent?.getBooleanExtra(EXTRA_UNLOCK, false) == true
    expectedPackage = intent?.getStringExtra(EXTRA_TARGET_PACKAGE)

    loginId = intent?.getStringExtra(EXTRA_LOGIN_ID)
    expectedWebDomain = intent?.getStringExtra(EXTRA_WEB_DOMAIN)
      ?.trim()
      ?.takeIf { it.isNotEmpty() }
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

    if (needsUnlock) {
      if (canUseBiometricUnlock()) promptBiometricUnlock() else showMasterPassword()
      return
    }

    authenticateDevice()
  }

  /** Biometric vault unlock is available only when the user turned it on in
   * the app and the Keystore-wrapped vault key still exists and matches. */
  private fun canUseBiometricUnlock(): Boolean =
    AutofillVaultReader.biometricsEnabled(this) &&
      AutofillBiometricKey.has(this) &&
      AutofillBiometricKey.canPrompt(this)

  private fun promptBiometricUnlock() {
    val cipher = AutofillBiometricKey.decryptCipher(this)
    if (cipher == null) {
      showMasterPassword("Fingerprint or face changed. Enter your master password once in the app to turn it back on.")
      return
    }
    // Clear any password surface; the system prompt draws over the form.
    setContentView(FrameLayout(this))
    val prompt = BiometricPrompt(
      this,
      ContextCompat.getMainExecutor(this),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          val authenticated = result.cryptoObject?.cipher ?: return showMasterPassword()
          Thread {
            val key = try {
              AutofillBiometricKey.unwrap(this@AutofillAuthActivity, authenticated)
            } catch (_: Exception) { null }
            val valid = key != null && AutofillVaultReader.matchesVault(this@AutofillAuthActivity, key)
            runOnUiThread {
              if (finished || isDestroyed || epoch != AutofillSession.epoch()) {
                key?.fill(0)
                cancel()
              } else if (!valid) {
                key?.fill(0)
                // The vault was reset or re-created since biometrics were set up.
                AutofillBiometricKey.clear(this@AutofillAuthActivity)
                showMasterPassword("Your vault changed. Enter your master password.")
              } else {
                vaultKey = key
                // The biometric (or device credential) check already happened.
                Thread { succeed() }.start()
              }
            }
          }.start()
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
          if (finished) return
          if (errorCode == BiometricPrompt.ERROR_CANCELED) {
            // The system dismissed the prompt (e.g. the form went away).
            cancel()
          } else {
            // Back/cancel, "Use master password", lockout or hardware trouble.
            // Android 11+ shows no negative button when the device PIN is
            // allowed, so cancelling must still offer the master password.
            showMasterPassword()
          }
        }
      },
    )
    val builder = BiometricPrompt.PromptInfo.Builder()
      .setTitle("Unlock FlexiVault")
      .setSubtitle(expectedWebDomain?.let { "Fill $it" } ?: "Fill this form without opening your vault")
      .setAllowedAuthenticators(AutofillBiometricKey.authenticators())
      .setConfirmationRequired(false)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      builder.setNegativeButtonText("Use master password")
    }
    prompt.authenticate(builder.build(), BiometricPrompt.CryptoObject(cipher))
  }

  private fun authenticateDevice() {

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
    deviceAuthenticated = true
    if (needsUnlock && loginId == null) {
      showLoginPicker()
      return
    }

    // A lock, reset, expiry or settings change may have cleared the cache while
    // the prompt was open. Do not complete a stale dataset in that case.
    val id = loginId
    val login = try {
      id?.let {
        val logins = if (needsUnlock) {
          if (epoch != AutofillSession.epoch()) return@let null
          vaultKey?.let { key -> matchingLogins(key) } ?: emptyList()
        } else {
          if (!AutofillSession.isUnlocked()) return@let null
          AutofillPendingStore.apply(this, AutofillCache.read(this))
        }
        logins
          .firstOrNull { login -> login.id == it }
      }
    } catch (_: Exception) {
      null
    }
    if (login == null) {
      cancel()
      return
    }

    val currentFields = assistFields()
    if (
      currentFields != null &&
      (
        (!expectedPackage.isNullOrBlank() && currentFields.packageName != expectedPackage) ||
          (!expectedWebDomain.isNullOrBlank() && currentFields.webDomain != expectedWebDomain)
        )
    ) {
      cancel()
      return
    }

    // Re-check the browser target after the device prompt. A sync could have
    // changed the item's hosts while the prompt was open.
    val expectedHost = expectedWebDomain
    if (
      expectedHost != null &&
      login.hosts.none { saved -> AutofillMatcher.hostMatches(expectedHost, saved) }
    ) {
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

    runOnUiThread {
      if (finished) return@runOnUiThread
      if (needsUnlock && epoch != AutofillSession.epoch()) return@runOnUiThread cancel()
      if (!needsUnlock && !AutofillSession.isUnlocked()) return@runOnUiThread cancel()
      finished = true
      // Dataset-level authentication needs a populated result, not just OK.
      setResult(RESULT_OK,
        Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset))
      finish()
    }
  }

  private fun matchingLogins(key: ByteArray): List<AutofillLogin> {
    check(deviceAuthenticated && epoch == AutofillSession.epoch()) { "Unlock was cancelled." }
    val fields = assistFields()
    val targetPackage = expectedPackage ?: fields?.packageName
    check(!targetPackage.isNullOrBlank() && targetPackage != packageName) { "The form changed." }
    if (fields != null) {
      check(fields.packageName == targetPackage) { "The app changed. Start unlock again." }
      if (AutofillMatcher.isBrowserPackage(targetPackage)) {
        check(!fields.webDomain.isNullOrBlank() && fields.webDomain == expectedWebDomain) {
          "The website changed. Start unlock again."
        }
      }
    }
    val browser = AutofillMatcher.isBrowserPackage(targetPackage)
    check(!browser || !expectedWebDomain.isNullOrBlank()) { "The website could not be verified." }
    val appLabel = if (browser) null else try {
      packageManager.getApplicationLabel(packageManager.getApplicationInfo(targetPackage, 0)).toString()
    } catch (_: Exception) { null }
    val tokens = AutofillMatcher.targetTokens(targetPackage, appLabel)
    return AutofillPendingStore.apply(this, AutofillVaultReader.readLogins(this, key))
      .map { it to AutofillMatcher.score(it, expectedWebDomain, targetPackage, tokens) }
      .filter { it.second > 0 }.sortedByDescending { it.second }.take(8).map { it.first }
  }

  private fun showMasterPassword(notice: String? = null) {
    if (finished) return
    window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
    window.setDimAmount(0.45f)
    val card = overlay("Unlock FlexiVault", notice ?: "Fill this form without opening your vault.")
    val label = TextView(this).apply {
      text = "Master password"
      textSize = 12f
      setTextColor(color(R.color.autofill_muted))
      setPadding(0, dp(12), 0, dp(6))
    }
    card.addView(label)
    val input = EditText(this).apply {
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
      setSingleLine(true)
      hint = "Enter your master password"
      textSize = 15f
      setTextColor(color(R.color.autofill_text))
      setHintTextColor(color(R.color.autofill_muted))
      setPadding(dp(12), dp(10), dp(12), dp(10))
      background = GradientDrawable().apply {
        setColor(color(R.color.autofill_field)); cornerRadius = dp(10).toFloat()
      }
      importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
      filterTouchesWhenObscured = true
      isSaveEnabled = false
      imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE or
        android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
    }
    card.addView(input)
    val status = TextView(this).apply {
      setTextColor(color(R.color.autofill_muted)); textSize = 12f
      text = "Next, confirm with your fingerprint or device lock."
      setPadding(0, dp(12), 0, dp(12))
    }
    card.addView(status)
    val submit = action("Unlock", true) {}
    val submitPassword = {
      if (!busy && !finished) {
        val password = input.text.toString()
        if (password.isEmpty() || password.length > 4096) {
          input.error = "Enter your master password"
        } else {
          busy = true
          input.setText("")
          input.isEnabled = false
          submit.isEnabled = false
          submit.text = "Unlocking…"
          Thread {
            val key = try { AutofillVaultReader.unlock(this, password) } catch (_: Exception) { null }
            runOnUiThread {
              if (finished || isDestroyed || epoch != AutofillSession.epoch()) {
                key?.fill(0)
                cancel()
              } else if (key == null) {
                busy = false
                input.isEnabled = true
                submit.isEnabled = true
                submit.text = "Unlock"
                status.text = "Could not unlock. Check your master password and try again."
                input.requestFocus()
              } else {
                vaultKey = key
                // Remove the password surface before the system-auth prompt.
                setContentView(FrameLayout(this))
                authenticateDevice()
              }
            }
          }.start()
        }
      }
    }
    submit.setOnClickListener { submitPassword() }
    input.setOnEditorActionListener { _, _, _ -> submitPassword(); true }
    card.addView(submit)
    if (canUseBiometricUnlock()) {
      card.addView(action("Use fingerprint or face", false) {
        if (!busy && !finished) promptBiometricUnlock()
      })
    }
    card.addView(action("Not now", false) { cancel() })
  }

  private fun showLoginPicker() {
    val key = vaultKey ?: return cancel()
    Thread {
      val matches = try {
        // Hydrate the Keystore-encrypted login-only cache only after both the
        // master password and device authentication succeeded. This also lets
        // multi-step sign-in continue on the next form without opening the app.
        val all = AutofillVaultReader.readLogins(this, key)
        AutofillSession.configure(epoch, AutofillVaultReader.autoLockMinutes(this)) {
          AutofillCache.writeLogins(this, all)
        }
        matchingLogins(key)
      } catch (_: Exception) { emptyList() }
      runOnUiThread {
        if (finished || isDestroyed || epoch != AutofillSession.epoch()) return@runOnUiThread cancel()
        val card = overlay("Choose a login", expectedWebDomain ?: "Fill this app with FlexiVault")
        busy = false
        if (matches.isEmpty()) {
          card.addView(TextView(this).apply {
            text = "No saved logins match this form."
            setTextColor(color(R.color.autofill_muted)); setPadding(0, dp(16), 0, dp(16))
          })
        }
        for (login in matches) {
          card.addView(action(listOfNotNull(login.name, login.username).joinToString(" · "), false) {
            if (!busy) {
              busy = true
              loginId = login.id
              // Re-read after selection: deletion, reset or changed hosts must
              // never complete an old credential from the picker.
              Thread { succeed() }.start()
            }
          })
        }
        card.addView(action("Not now", false) { cancel() })
      }
    }.start()
  }

  private fun overlay(title: String, subtitle: String): LinearLayout {
    val root = FrameLayout(this).apply { setPadding(dp(22), dp(22), dp(22), dp(22)) }
    val scroll = ScrollView(this)
    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(22), dp(20), dp(22), dp(16))
      background = GradientDrawable().apply {
        setColor(color(R.color.autofill_card)); cornerRadius = dp(22).toFloat()
        setStroke(dp(1), color(R.color.autofill_field))
      }
    }
    scroll.addView(card)
    root.addView(scroll, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
    card.addView(TextView(this).apply {
      text = title; textSize = 20f; setTypeface(typeface, android.graphics.Typeface.BOLD)
      setTextColor(color(R.color.autofill_text))
    })
    card.addView(TextView(this).apply {
      text = subtitle; textSize = 13f; setTextColor(color(R.color.autofill_muted))
      setPadding(0, dp(6), 0, dp(10))
    })
    setContentView(root)
    return card
  }

  private fun action(label: String, primary: Boolean, click: () -> Unit): Button = Button(this).apply {
    text = label; isAllCaps = false; minHeight = dp(48)
    setTextColor(color(if (primary) R.color.activityBackground else R.color.autofill_text))
    backgroundTintList = ColorStateList.valueOf(color(if (primary) R.color.autofill_accent else R.color.autofill_field))
    filterTouchesWhenObscured = true
    setOnClickListener { click() }
  }

  private fun color(id: Int): Int = ContextCompat.getColor(this, id)
  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  override fun onDestroy() {
    finished = true
    vaultKey?.fill(0)
    vaultKey = null
    super.onDestroy()
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
    runOnUiThread {
      if (finished) return@runOnUiThread
      finished = true
      setResult(RESULT_CANCELED)
      finish()
    }
  }
}
