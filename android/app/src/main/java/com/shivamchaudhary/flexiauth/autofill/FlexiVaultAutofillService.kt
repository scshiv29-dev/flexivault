package com.shivamchaudhary.flexiauth.autofill

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillValue
import com.shivamchaudhary.flexiauth.R
import java.util.UUID

class FlexiVaultAutofillService : AutofillService() {
  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback,
  ) {
    try {
      val structure: AssistStructure =
        request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess(null)
      val fields = AutofillParser.parse(structure) ?: return callback.onSuccess(null)

      if (fields.packageName == packageName) {
        return callback.onSuccess(null)
      }

      // Browsers are matched by web domain only. If a browser does not expose
      // one, neither package-based guesses nor host-less saves are safe.
      val isBrowser = AutofillMatcher.isBrowserPackage(fields.packageName)
      if (isBrowser && fields.webDomain.isNullOrBlank()) {
        return callback.onSuccess(null)
      }
      if (!isBrowser && fields.packageName.isNullOrBlank()) {
        return callback.onSuccess(null)
      }

      // Save prompts are independent of the read-only cache and of device-auth
      // availability for filling. A new vault can therefore capture a login on
      // the first form submission, before any item has been cached.
      val canFill = AutofillAuthActivity.canAuthenticate(this)
      val logins = AutofillPendingStore.apply(this, AutofillCache.read(this))

      // Resolve the app label for native apps, including WebView-based ones
      // that expose a web domain.
      val appLabel = if (isBrowser) null else resolveAppLabel(fields.packageName)
      val targetTokens = AutofillMatcher.targetTokens(fields.packageName, appLabel)
      val matches = if (canFill) {
        logins
          .map { login ->
            login to AutofillMatcher.score(login, fields.webDomain, fields.packageName, targetTokens)
          }
          .filter { it.second > 0 }
          .sortedByDescending { it.second }
          .take(8)
          .map { it.first }
      } else {
        emptyList()
      }

      val response = FillResponse.Builder()
      var added = 0
      matches.forEachIndexed { index, login ->
        val dataset = try {
          buildDataset(login, fields, index)
        } catch (_: Exception) {
          // One malformed presentation must not discard every other match.
          null
        }
        if (dataset != null) {
          response.addDataset(dataset)
          added += 1
        }
      }

      var saveRequested = false
      fields.passwordId?.let { passwordId ->
        val required = arrayOf(passwordId)
        val builder = SaveInfo.Builder(SaveInfo.SAVE_DATA_TYPE_PASSWORD, required)
        fields.usernameId?.let { usernameId ->
          builder.setOptionalIds(arrayOf(usernameId))
        }
        response.setSaveInfo(builder.build())
        saveRequested = true
      }

      if (added == 0 && !saveRequested) {
        callback.onSuccess(null)
      } else {
        callback.onSuccess(response.build())
      }
    } catch (_: Exception) {
      // Never crash the system autofill UI because one form was unusual.
      callback.onSuccess(null)
    }
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    try {
      var username: String? = null
      var password: String? = null
      var webDomain: String? = null
      var targetPackage: String? = null

      // A multi-step form can split the username and password across fill
      // contexts. Merge non-null values from every context, keeping the latest.
      for (context in request.fillContexts) {
        val data = try {
          context.structure?.let { AutofillParser.parseSave(it) }
        } catch (_: Exception) {
          null
        } ?: continue
        username = data.username ?: username
        password = data.password ?: password
        webDomain = data.webDomain ?: webDomain
        targetPackage = data.packageName ?: targetPackage
      }

      if (password.isNullOrEmpty() || targetPackage == packageName) {
        callback.onSuccess()
        return
      }

      val isBrowser = AutofillMatcher.isBrowserPackage(targetPackage)
      if (isBrowser && webDomain.isNullOrBlank()) {
        callback.onSuccess()
        return
      }
      if (!isBrowser && targetPackage.isNullOrBlank()) {
        callback.onSuccess()
        return
      }

      val appLabel = if (isBrowser) null else resolveAppLabel(targetPackage)
      val targetTokens = AutofillMatcher.targetTokens(targetPackage, appLabel)
      val logins = AutofillPendingStore.apply(this, AutofillCache.read(this))
      val matches = logins
        .map { login ->
          login to AutofillMatcher.score(login, webDomain, targetPackage, targetTokens)
        }
        .filter { it.second > 0 }
        .sortedByDescending { it.second }
        .map { it.first }

      val normalizedUsername = username?.trim()?.take(500)?.ifEmpty { null }
      val existing = matches.firstOrNull {
        it.username?.trim()?.equals(normalizedUsername, ignoreCase = true) == true
      } ?: if (normalizedUsername == null) {
        matches.firstOrNull { it.username.isNullOrBlank() }
      } else {
        null
      }

      // The form was submitted with the credentials we already have. Do not
      // interrupt the user with a redundant prompt.
      if (existing != null && existing.password == password) {
        callback.onSuccess()
        return
      }

      val defaultName = appLabel?.takeIf { it.isNotBlank() }
        ?: webDomain?.takeIf { it.isNotBlank() }
        ?: targetPackage?.takeIf { it.isNotBlank() }
        ?: "Login"
      val save = AutofillPendingSave(
        itemId = existing?.id ?: UUID.randomUUID().toString(),
        mode = if (existing != null) "update" else "create",
        name = existing?.name ?: defaultName,
        username = normalizedUsername,
        password = password,
        hosts = webDomain?.let { listOf(it) } ?: emptyList(),
        packages = if (!isBrowser && targetPackage != null) {
          listOf(targetPackage)
        } else {
          emptyList()
        },
        createdAt = System.currentTimeMillis(),
      )
      val token = AutofillSaveHandoff.put(save)
      try {
        startActivity(
          Intent(this, AutofillSaveActivity::class.java)
            .putExtra(AutofillSaveActivity.EXTRA_TOKEN, token)
            // A service needs NEW_TASK. The activity has an empty task affinity,
            // is translucent and is excluded from recents, so it appears over
            // the calling app without switching to FlexiVault's main task.
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      } catch (_: Exception) {
        AutofillSaveHandoff.discard(token)
      }
    } catch (_: Exception) {
      // A save prompt must never crash the calling app or the autofill service.
    }
    callback.onSuccess()
  }

  private fun buildDataset(
    login: AutofillLogin,
    fields: AutofillFields,
    index: Int,
  ): Dataset? {
    val presentation = AutofillPresentation.build(this, login)

    val builder = Dataset.Builder(presentation)
    var values = 0
    fields.usernameId?.let { id ->
      val username = login.username?.takeIf { it.isNotBlank() }
      if (username != null) {
        builder.setValue(id, AutofillValue.forText(username), presentation)
        values += 1
      }
    }
    fields.passwordId?.let { id ->
      builder.setValue(id, AutofillValue.forText(login.password), presentation)
      values += 1
    }
    if (values == 0) return null

    val intent = Intent(this, AutofillAuthActivity::class.java).apply {
      putExtra(AutofillAuthActivity.EXTRA_LOGIN_ID, login.id)
      putExtra(AutofillAuthActivity.EXTRA_LOGIN_NAME, login.name)
      putExtra(AutofillAuthActivity.EXTRA_USERNAME_ID, fields.usernameId)
      putExtra(AutofillAuthActivity.EXTRA_PASSWORD_ID, fields.passwordId)
      putExtra(
        AutofillAuthActivity.EXTRA_WEB_DOMAIN,
        fields.webDomain.takeIf { AutofillMatcher.isBrowserPackage(fields.packageName) },
      )
      // Deliberately no FLAG_ACTIVITY_NEW_TASK: the auth activity must stay in
      // the caller's task so it appears over the app being filled and finishing
      // returns there. NEW_TASK would bring FlexiVault's own task forward.
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      5000 + index,
      intent,
      PendingIntent.FLAG_CANCEL_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          // The platform fills in the assist structure and client state, and
          // needs to add the authenticated dataset to the result.
          PendingIntent.FLAG_MUTABLE
        } else {
          0
        }),
    )
    builder.setAuthentication(pendingIntent.intentSender)
    return builder.build()
  }

  private fun resolveAppLabel(targetPackage: String?): String? {
    if (targetPackage.isNullOrBlank() || targetPackage == packageName) return null
    return try {
      val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.getApplicationInfo(
          targetPackage,
          PackageManager.ApplicationInfoFlags.of(0L),
        )
      } else {
        @Suppress("DEPRECATION")
        packageManager.getApplicationInfo(targetPackage, 0)
      }
      packageManager.getApplicationLabel(info).toString()
    } catch (_: Exception) {
      // Package visibility or a missing label must not block package-token
      // matching.
      null
    }
  }
}
