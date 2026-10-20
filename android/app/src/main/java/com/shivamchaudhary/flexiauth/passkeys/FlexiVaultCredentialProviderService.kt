package com.shivamchaudhary.flexiauth.passkeys

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialUnknownException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginCreatePublicKeyCredentialRequest
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import androidx.credentials.provider.CreateEntry
import androidx.credentials.provider.CredentialEntry
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.ProviderClearCredentialStateRequest
import androidx.credentials.provider.PublicKeyCredentialEntry

@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
class FlexiVaultCredentialProviderService : CredentialProviderService() {
  companion object {
    const val ACTION_CREATE = "com.shivamchaudhary.flexiauth.passkey.CREATE"
    const val ACTION_GET = "com.shivamchaudhary.flexiauth.passkey.GET"
    const val EXTRA_CREDENTIAL_ID = "credential_id"
    const val EXTRA_OPTION_INDEX = "option_index"

    private const val CREATE_REQUEST_CODE = 7301
  }

  override fun onBeginCreateCredentialRequest(
    request: BeginCreateCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
  ) {
    try {
      if (request !is BeginCreatePublicKeyCredentialRequest) {
        callback.onError(CreateCredentialUnknownException("This credential type is not supported."))
        return
      }
      val hash = request.clientDataHash
      val origin = PasskeyOrigin.resolve(this, request.callingAppInfo, hash)
      val options = PasskeyRequestParser.parseCreation(
        request.requestJson,
        PasskeyOrigin.fallbackRpId(origin),
      )
      if (options == null) {
        callback.onError(CreateCredentialUnknownException("The passkey request is invalid."))
        return
      }
      if (!PasskeyOrigin.isAllowedCaller(hash, origin, options.rpId)) {
        callback.onResult(BeginCreateCredentialResponse.Builder().build())
        return
      }

      // The RP asked the authenticator not to create a duplicate credential.
      // Returning no entries is the correct provider response when every
      // excluded credential already exists.
      if (
        options.excludeCredentialIds.isNotEmpty() &&
        PasskeyStore.read(this).any {
          it.rpId == options.rpId &&
            it.credentialId in options.excludeCredentialIds
        }
      ) {
        callback.onResult(BeginCreateCredentialResponse.Builder().build())
        return
      }

      val label = options.userDisplayName
        .ifBlank { options.userName }
        .ifBlank { options.rpName }
        .ifBlank { "FlexiVault" }
        .take(80)
      val entry = CreateEntry.Builder(label, createPendingIntent(ACTION_CREATE, null))
        .setDescription(
          if (options.rpName.isBlank()) {
            "Save a passkey in FlexiVault"
          } else {
            "Save a passkey for ${options.rpName} in FlexiVault"
          }
        )
        .build()
      callback.onResult(
        BeginCreateCredentialResponse.Builder()
          .addCreateEntry(entry)
          .build()
      )
    } catch (_: Exception) {
      callback.onError(CreateCredentialUnknownException("FlexiVault could not prepare a passkey."))
    }
  }

  override fun onBeginGetCredentialRequest(
    request: BeginGetCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
  ) {
    try {
      val entries = ArrayList<CredentialEntry>()
      val stored = PasskeyStore.read(this)

      for ((optionIndex, option) in request.beginGetCredentialOptions.withIndex()) {
        if (option !is BeginGetPublicKeyCredentialOption) continue
        val hash = option.clientDataHash
        val origin = PasskeyOrigin.resolve(this, request.callingAppInfo, hash)
        val options = PasskeyRequestParser.parseGet(
          option.requestJson,
          PasskeyOrigin.fallbackRpId(origin),
        ) ?: continue
        if (!PasskeyOrigin.isAllowedCaller(hash, origin, options.rpId)) continue
        val matching = stored.filter { credential ->
          credential.rpId == options.rpId &&
            (
              options.allowCredentialIds.isEmpty() ||
                credential.credentialId in options.allowCredentialIds
              )
        }
        for (credential in matching) {
          val pendingIntent = createPendingIntent(
            ACTION_GET,
            credential.credentialId,
            optionIndex,
          )
          val entry = PublicKeyCredentialEntry.Builder(
            this,
            credential.userName.ifBlank { "FlexiVault" },
            pendingIntent,
            option,
          )
            .setDisplayName(credential.displayName.ifBlank { credential.userName })
            .build()
          entries.add(entry)
        }
      }

      callback.onResult(
        BeginGetCredentialResponse.Builder()
          .setCredentialEntries(entries)
          .build()
      )
    } catch (_: Exception) {
      callback.onError(GetCredentialUnknownException("FlexiVault could not load passkeys."))
    }
  }

  override fun onClearCredentialStateRequest(
    request: ProviderClearCredentialStateRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<Void?, ClearCredentialException>,
  ) {
    // FlexiVault does not maintain sticky selector state, so there is nothing
    // to clear.
    callback.onResult(null)
  }

  private fun createPendingIntent(
    action: String,
    credentialId: String?,
    optionIndex: Int? = null,
  ): PendingIntent {
    val intent = Intent(this, PasskeyActivity::class.java).apply {
      this.action = action
      // Unique data keeps two credential IDs with the same String hash from
      // updating each other's PendingIntent extras.
      data = Uri.parse("flexivault://passkey/$action/${credentialId ?: "create"}")
      setPackage(packageName)
      if (credentialId != null) putExtra(EXTRA_CREDENTIAL_ID, credentialId)
      if (optionIndex != null) putExtra(EXTRA_OPTION_INDEX, optionIndex)
    }
    val requestCode = if (credentialId == null) {
      CREATE_REQUEST_CODE
    } else {
      credentialId.hashCode() and 0x7FFFFFFF
    }
    return PendingIntent.getActivity(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }
}
