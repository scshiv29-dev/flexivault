package com.shivamchaudhary.flexiauth.autofill

/**
 * Ranks cached logins for an autofill request.
 *
 * Browser targets are matched by web domain only. Native apps are matched by an
 * explicit package first, then by the app's label and package-name tokens
 * against the login name and saved hosts. That inference lets a "Reddit" login
 * fill the Reddit app without requiring the user to add
 * `com.reddit.frontpage` manually.
 */
object AutofillMatcher {
  private val SEPARATOR = Regex("[^a-z0-9]+")
  private val GENERIC_TOKENS = setOf(
    "com", "org", "net", "io", "co", "www", "app", "apps", "android",
    "mobile", "client", "frontpage", "official", "main", "release",
    "production", "prod", "beta", "alpha", "dev", "debug", "login",
    "signin", "signup", "auth", "account", "accounts", "service",
    "services", "inc", "llc", "ltd", "the", "and", "for", "with",
    "of", "my", "work", "personal", "email", "user", "username",
    "password", "pass", "test", "demo", "default", "web", "online",
    "site",
  )
  private val ALIASES = mapOf(
    "x" to "twitter",
    "twitter" to "x",
    "fb" to "facebook",
    "ig" to "instagram",
    "yt" to "youtube",
    "wa" to "whatsapp",
    "gm" to "gmail",
    "ms" to "microsoft",
  )
  private val BROWSER_PACKAGES = setOf(
    "com.android.chrome",
    "com.chrome.beta",
    "com.chrome.dev",
    "com.chrome.canary",
    "com.microsoft.emmx",
    "org.mozilla.firefox",
    "org.mozilla.firefox_beta",
    "com.brave.browser",
    "com.opera.browser",
    "com.opera.mini.native",
    "com.sec.android.app.sbrowser",
    "com.duckduckgo.mobile.android",
    "com.vivaldi.browser",
    "com.kiwibrowser.browser",
    "com.yandex.browser",
  )

  fun isBrowserPackage(packageName: String?): Boolean {
    val normalised = packageName?.trim()?.lowercase() ?: return false
    return normalised in BROWSER_PACKAGES
  }

  fun targetTokens(packageName: String?, appLabel: String?): Set<String> {
    val result = tokens(packageName).toMutableSet()
    result.addAll(tokens(appLabel))
    return result
  }

  fun score(
    login: AutofillLogin,
    webDomain: String?,
    packageName: String?,
    targetTokens: Set<String>,
  ): Int {
    val browserTarget = isBrowserPackage(packageName)
    var explicit = 0
    if (
      !browserTarget &&
      !packageName.isNullOrBlank() &&
      login.packages.any { it.equals(packageName, ignoreCase = true) }
    ) {
      explicit = 100
    }

    if (!webDomain.isNullOrBlank()) {
      val target = normaliseHost(webDomain)
      if (target != null && login.hosts.any { hostMatches(target, it) }) {
        explicit = maxOf(explicit, 90)
      }
    }

    // A browser target is matched by its real web domain only. Do not infer
    // from the browser package or label, otherwise a login called "Chrome" or
    // "Google" would appear on every page.
    if (browserTarget) return explicit

    if (explicit > 0) return explicit
    if (targetTokens.isEmpty()) return 0

    val loginTokens = tokens(login.name).toMutableSet()
    for (host in login.hosts) {
      loginTokens.addAll(hostTokens(host))
    }
    val shared = loginTokens.intersect(targetTokens)
    if (shared.isEmpty()) return 0
    return 40 + minOf(shared.size * 5, 20)
  }

  fun hostMatches(targetDomain: String, savedHost: String): Boolean {
    val target = normaliseHost(targetDomain) ?: return false
    val saved = normaliseHost(savedHost) ?: return false
    if (saved != "localhost" && !saved.contains('.')) return false
    return target == saved || target.endsWith(".$saved")
  }

  private fun hostTokens(host: String): Set<String> {
    val normalised = normaliseHost(host) ?: return emptySet()
    if (normalised == "localhost") return setOf("localhost")
    val labels = normalised.split('.').filter { it.isNotEmpty() }
    if (labels.size < 2) return tokens(normalised)
    return tokens(labels.dropLast(1).joinToString(" "))
  }

  private fun tokens(value: String?): Set<String> {
    if (value.isNullOrBlank()) return emptySet()
    val raw = value.lowercase().split(SEPARATOR).filter { it.isNotEmpty() }
    val result = raw
      .filter { it.length >= 4 && it !in GENERIC_TOKENS }
      .toMutableSet()
    for (token in raw) {
      ALIASES[token]?.let(result::add)
    }
    return result
  }

  private fun normaliseHost(value: String): String? {
    var host = value.trim().lowercase()
    host = host.removePrefix("https://").removePrefix("http://")
    host = host.substringBefore('/').substringBefore('?').substringBefore('#')
    host = host.substringAfterLast('@')
    host = if (host.startsWith("[")) {
      val end = host.indexOf(']')
      if (end > 1) host.substring(1, end) else ""
    } else {
      host.substringBefore(':')
    }
    host = host.trimEnd('.').removePrefix("www.")
    return host.ifEmpty { null }
  }
}
