package com.shivamchaudhary.flexiauth.autofill

import android.content.Context
import android.widget.RemoteViews
import com.shivamchaudhary.flexiauth.R

/** Shared presentation used by the dataset shown in the picker and the authenticated result. */
object AutofillPresentation {
  fun build(context: Context, login: AutofillLogin): RemoteViews =
    RemoteViews(context.packageName, R.layout.autofill_dataset).apply {
      setTextViewText(R.id.autofill_title, login.name)
      setTextViewText(
        R.id.autofill_subtitle,
        listOfNotNull(login.username?.takeIf { it.isNotBlank() }, "FlexiVault")
          .joinToString(" \u00B7 "),
      )
      setImageViewResource(R.id.autofill_icon, R.mipmap.ic_launcher)
    }
}
