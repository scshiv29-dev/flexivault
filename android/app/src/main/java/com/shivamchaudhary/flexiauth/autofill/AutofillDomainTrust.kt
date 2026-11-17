package com.shivamchaudhary.flexiauth.autofill

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build

/**
 * Decides whether the `webDomain` in an autofill request may be used to match
 * saved websites.
 *
 * A browser reports the page the user is on, so its domain is trusted. Any
 * other app can put an arbitrary domain in its view tree (a phishing app could
 * claim `paypal.com`), so a native app's domain is used only when the app owns
 * it:
 * - the app is the verified Android App Links handler (Android 12+) for that
 *   host or its main domain, or
 * - the app's package name sits under that main domain (`com.reddit.frontpage`
 *   for `m.reddit.com`). See [AutofillMatcher.packageOwnsDomain].
 *
 * An untrusted domain is dropped. The app is then matched by package and app
 * name only, as for an app without a web view.
 */
object AutofillDomainTrust {
  fun trustedWebDomain(context: Context, packageName: String?, webDomain: String?): String? {
    if (webDomain.isNullOrBlank() || packageName.isNullOrBlank()) return null
    if (AutofillMatcher.isBrowserPackage(packageName)) return webDomain
    if (AutofillMatcher.packageOwnsDomain(packageName, webDomain)) return webDomain
    return if (isVerifiedLinkHandler(context, packageName, webDomain)) webDomain else null
  }

  private fun isVerifiedLinkHandler(context: Context, packageName: String, webDomain: String): Boolean {
    // Before Android 12 an app could become the link handler without domain
    // verification, so the result would not prove ownership.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
    val main = AutofillMatcher.mainDomain(webDomain)
    val hosts = listOfNotNull(webDomain, main, main?.let { "www.$it" }).distinct()
    return hosts.any { host ->
      try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://$host/"))
          .addCategory(Intent.CATEGORY_BROWSABLE)
        // On Android 12+ a web link resolves straight to an app only when the
        // app is verified for that host (or the user approved it in settings);
        // otherwise it resolves to the browser or the chooser.
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.packageManager.resolveActivity(
            intent,
            PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()),
          )
        } else {
          @Suppress("DEPRECATION")
          context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)
        }
        info?.activityInfo?.packageName == packageName
      } catch (_: Exception) {
        false
      }
    }
  }
}
