package com.shivamchaudhary.flexiauth.autofill

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Intent
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
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

      val matches = logins.filter { login ->
        matchesTarget(login, fields.webDomain, fields.packageName)
      }.take(8)
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
    val presentation = RemoteViews(packageName, R.layout.autofill_dataset).apply {
      setTextViewText(R.id.autofill_title, login.name)
      setTextViewText(
        R.id.autofill_subtitle,
        listOfNotNull(login.username?.takeIf { it.isNotBlank() }, "FlexiVault")
          .joinToString(" · ")
      )
      setImageViewResource(R.id.autofill_icon, R.mipmap.ic_launcher)
    }

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
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val pendingIntent = PendingIntent.getActivity(
      this,
      5000 + index,
      intent,
      PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    builder.setAuthentication(pendingIntent.intentSender)
    return builder.build()
  }

  private fun matchesTarget(
    login: AutofillLogin,
    domain: String?,
    targetPackage: String?,
  ): Boolean {
    if (
      targetPackage != null &&
      login.packages.any { it.equals(targetPackage, ignoreCase = true) }
    ) {
      return true
    }
    if (domain.isNullOrBlank()) return false
    val target = domain.lowercase().trim().trimEnd('.')
    return login.hosts.any { saved ->
      val host = saved.lowercase().trim().trimEnd('.')
      if (host != "localhost" && !host.contains('.')) return@any false
      target == host || target.endsWith(".$host")
    }
  }
}
