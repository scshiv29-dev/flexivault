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
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillValue
import com.shivamchaudhary.flexiauth.R

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
      if (!AutofillAuthActivity.canAuthenticate(this)) {
        // Filling without a device credential would hand passwords to any app
        // that can draw a login form. Fail closed.
        return callback.onSuccess(null)
      }

      val logins = AutofillCache.read(this)
      if (logins.isEmpty()) return callback.onSuccess(null)

      // Resolve the app label for native apps, including WebView-based ones
      // that expose a web domain. Browsers are matched by web domain only; if
      // a browser does not expose one, package-based guesses would surface
      // unrelated logins on every page.
      val isBrowser = AutofillMatcher.isBrowserPackage(fields.packageName)
      if (isBrowser && fields.webDomain.isNullOrBlank()) {
        return callback.onSuccess(null)
      }
      val appLabel = if (isBrowser) null else resolveAppLabel(fields.packageName)
      val targetTokens = AutofillMatcher.targetTokens(fields.packageName, appLabel)
      val matches = logins
        .map { login ->
          login to AutofillMatcher.score(login, fields.webDomain, fields.packageName, targetTokens)
        }
        .filter { it.second > 0 }
        .sortedByDescending { it.second }
        .take(8)
        .map { it.first }
      if (matches.isEmpty()) return callback.onSuccess(null)

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

      callback.onSuccess(if (added > 0) response.build() else null)
    } catch (_: Exception) {
      // Never crash the system autofill UI because one form was unusual.
      callback.onSuccess(null)
    }
  }

  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    // Saving new credentials is intentionally not supported yet. The app is the
    // writer; the autofill service is a read-only fill path.
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
