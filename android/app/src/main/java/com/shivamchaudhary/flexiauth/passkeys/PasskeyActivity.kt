package com.shivamchaudhary.flexiauth.passkeys

import android.app.KeyguardManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.annotation.RequiresApi
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.CreatePublicKeyCredentialResponse
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.PendingIntentHandler
import androidx.credentials.provider.ProviderCreateCredentialRequest
import androidx.credentials.provider.ProviderGetCredentialRequest
import androidx.fragment.app.FragmentActivity
import java.util.UUID

/**
 * Provider activity invoked after the user selects a FlexiVault passkey entry.
 * It deliberately uses the translucent theme and an empty task affinity so the
 * device-auth prompt floats over the calling browser or app without bringing
 * the main React Native task forward.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class PasskeyActivity : FragmentActivity() {
  companion object {
    private const val REQUEST_KEYGUARD = 7302
  }

  private var createRequest: ProviderCreateCredentialRequest? = null
  private var createOptions: PasskeyCreationOptions? = null
  private var createClientDataHash: ByteArray? = null
  private var createOrigin: String = ""

  private var getRequest: ProviderGetCredentialRequest? = null
  private var getOptions: PasskeyGetOptions? = null
  private var getClientDataHash: ByteArray? = null
  private var getOrigin: String = ""
  private var storedCredential: PasskeyCredential? = null

  private var promptSubtitle = "Confirm your identity"
  private var finished = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      finish()
      return
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    setFinishOnTouchOutside(false)

    if (savedInstanceState != null) {
      cancel()
      return
    }

    val source = intent ?: run {
      finish()
      return
    }
    val create = try {
      PendingIntentHandler.retrieveProviderCreateCredentialRequest(source)
    } catch (_: Exception) {
      null
    }
    if (create != null) {
      prepareCreate(create)
      return
    }
    val get = try {
      PendingIntentHandler.retrieveProviderGetCredentialRequest(source)
    } catch (_: Exception) {
      null
    }
    if (get != null) {
      prepareGet(get, source)
      return
    }
    finish()
  }

  private fun prepareCreate(request: ProviderCreateCredentialRequest) {
    val calling = request.callingRequest as? CreatePublicKeyCredentialRequest
    if (calling == null) {
      failCreate("FlexiVault received an unsupported passkey request.")
      return
    }
    val hash = calling.clientDataHash
    val origin = PasskeyOrigin.resolve(this, request.callingAppInfo, hash)
    val options = PasskeyRequestParser.parseCreation(
      calling.requestJson,
      PasskeyOrigin.fallbackRpId(origin),
    )
    if (options == null) {
      failCreate("This passkey request is invalid.")
      return
    }
    if (!PasskeyOrigin.isAllowedCaller(hash, origin, options.rpId)) {
      failCreate("FlexiVault could not verify the calling browser or app.")
      return
    }
    createRequest = request
    createOptions = options
    createClientDataHash = hash
    createOrigin = origin
    promptSubtitle = "Create a passkey for ${options.rpName.ifBlank { options.rpId }}"
    startAuthentication()
  }

  private fun prepareGet(request: ProviderGetCredentialRequest, source: Intent) {
    val optionIndex = source.getIntExtra(
      FlexiVaultCredentialProviderService.EXTRA_OPTION_INDEX,
      -1,
    )
    val indexed = if (optionIndex in request.credentialOptions.indices) {
      request.credentialOptions[optionIndex]
    } else {
      null
    }
    val option = (indexed as? GetPublicKeyCredentialOption)
      ?: request.credentialOptions
        .firstOrNull { it is GetPublicKeyCredentialOption } as? GetPublicKeyCredentialOption
    if (option == null) {
      failGet("FlexiVault received an unsupported passkey request.")
      return
    }
    val hash = option.clientDataHash
    val origin = PasskeyOrigin.resolve(this, request.callingAppInfo, hash)
    val options = PasskeyRequestParser.parseGet(
      option.requestJson,
      PasskeyOrigin.fallbackRpId(origin),
    )
    if (options == null) {
      failGet("This passkey request is invalid.")
      return
    }
    val credentialId = source.getStringExtra(FlexiVaultCredentialProviderService.EXTRA_CREDENTIAL_ID)
    if (credentialId.isNullOrBlank()) {
      failGet("FlexiVault could not identify the selected passkey.")
      return
    }
    val credential = PasskeyStore.find(this, credentialId)
    if (credential == null || credential.rpId != options.rpId) {
      failGet("This passkey is no longer available.")
      return
    }
    if (
      options.allowCredentialIds.isNotEmpty() &&
      credential.credentialId !in options.allowCredentialIds
    ) {
      failGet("This passkey is not allowed for this request.")
      return
    }
    if (!PasskeyOrigin.isAllowedCaller(hash, origin, options.rpId)) {
      failGet("FlexiVault could not verify the calling browser or app.")
      return
    }

    getRequest = request
    getOptions = options
    getClientDataHash = hash
    getOrigin = origin
    storedCredential = credential
    promptSubtitle = "Use passkey for ${options.rpId}"
    startAuthentication()
  }

  private fun startAuthentication() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && canUseBiometrics()) {
      promptBiometric()
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
    val prompt = BiometricPrompt(
      this,
      ContextCompat.getMainExecutor(this),
      object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
          succeed()
        }

        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
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

    val create = createOptions
    if (create != null) {
      try {
        val credential = PasskeyCrypto.createCredential(
          create,
          UUID.randomUUID().toString(),
        )
        val response = PasskeyCrypto.registrationResponseJson(
          credential,
          create,
          createClientDataHash,
          createOrigin,
        )
        if (!PasskeyStore.add(this, credential)) {
          failCreate("FlexiVault could not save this passkey.")
          return
        }
        val result = Intent()
        PendingIntentHandler.setCreateCredentialResponse(
          result,
          CreatePublicKeyCredentialResponse(response),
        )
        finished = true
        setResult(RESULT_OK, result)
        finish()
      } catch (_: Exception) {
        failCreate("FlexiVault could not create this passkey.")
      }
      return
    }

    val options = getOptions
    val credential = storedCredential
    if (options != null && credential != null) {
      try {
        val response = PasskeyCrypto.assertionResponseJson(
          credential,
          options,
          getClientDataHash,
          getOrigin,
        )
        try {
          PasskeyStore.markUsed(this, credential.credentialId)
        } catch (_: Exception) {
          // The assertion is already signed. Metadata updates are best-effort.
        }
        val result = Intent()
        PendingIntentHandler.setGetCredentialResponse(
          result,
          GetCredentialResponse(PublicKeyCredential(response)),
        )
        finished = true
        setResult(RESULT_OK, result)
        finish()
      } catch (_: Exception) {
        failGet("FlexiVault could not sign with this passkey.")
      }
      return
    }

    if (getRequest != null) {
      failGet("FlexiVault could not complete this passkey request.")
    } else {
      failCreate("FlexiVault could not complete this passkey request.")
    }
  }

  private fun failCreate(message: String) {
    if (finished) return
    finished = true
    val result = Intent()
    try {
      PendingIntentHandler.setCreateCredentialException(
        result,
        CreateCredentialUnknownException(message),
      )
    } catch (_: Exception) {
      // The result code still cancels the request.
    }
    setResult(RESULT_CANCELED, result)
    finish()
  }

  private fun failGet(message: String) {
    if (finished) return
    finished = true
    val result = Intent()
    try {
      PendingIntentHandler.setGetCredentialException(
        result,
        GetCredentialUnknownException(message),
      )
    } catch (_: Exception) {
      // The result code still cancels the request.
    }
    setResult(RESULT_CANCELED, result)
    finish()
  }

  private fun cancel() {
    if (finished) return
    finished = true
    val result = Intent()
    try {
      if (createRequest != null || getRequest == null) {
        PendingIntentHandler.setCreateCredentialException(
          result,
          CreateCredentialCancellationException("Passkey creation was cancelled."),
        )
      } else {
        PendingIntentHandler.setGetCredentialException(
          result,
          GetCredentialCancellationException("Passkey sign-in was cancelled."),
        )
      }
    } catch (_: Exception) {
      // The result code still cancels the request.
    }
    setResult(RESULT_CANCELED, result)
    finish()
  }
}
