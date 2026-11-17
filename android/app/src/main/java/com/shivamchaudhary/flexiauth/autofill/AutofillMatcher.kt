package com.shivamchaudhary.flexiauth.autofill

/**
 * Ranks cached logins for an autofill request.
 *
 * Browser targets are matched by web domain only. Native apps are matched by an
 * explicit package first, then by the app's label and package-name tokens
 * against the login name and saved hosts. That inference lets a "Reddit" login
 * fill the Reddit app without requiring the user to add
 * `com.reddit.frontpage` manually.
 *
 * [rank] turns scores into the dataset list: a definite match (package or web
 * domain) hides app-name guesses, and text the user already typed into the
 * username field narrows the list before it is capped.
 */
object AutofillMatcher {
  /** Scores at or above this come from a package or web-domain match. */
  const val DEFINITE_SCORE = 85
  /** Most datasets returned for one request. Android filters these further by
   * prefix as the user types, so the list must hold more than a screenful. */
  const val MAX_DATASETS = 40

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
  // Country domains that sell names one level down (example.co.uk).
  private val COUNTRY_SECOND_LEVEL = setOf(
    "co", "com", "net", "org", "gov", "edu", "ac", "gob", "ne", "or", "go",
    "mil", "nic", "ltd", "plc", "sch", "nom", "gen", "firm", "ind", "info", "biz",
  )
  // Hosting suffixes where each subdomain belongs to a different owner.
  private val SHARED_SUFFIXES = listOf(
    "s3.amazonaws.com", "github.io", "gitlab.io", "blogspot.com", "herokuapp.com",
    "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app",
    "firebaseapp.com", "appspot.com", "azurewebsites.net", "cloudfront.net",
    "onrender.com", "glitch.me", "wordpress.com", "wixsite.com", "myshopify.com",
    "sharepoint.com", "ngrok.io", "ngrok-free.app", "repl.co", "fly.dev",
    "railway.app", "surge.sh", "neocities.org", "weebly.com", "squarespace.com",
    "translate.goog", "duckdns.org", "no-ip.org", "ddns.net",
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
  // Phone makers ship their own default browser (vivo, OPPO, Xiaomi, Huawei).
  // An unlisted browser was treated as a native app, so logins were guessed
  // from the words "browser" or the brand instead of the page's web domain.
  private val BROWSER_PACKAGES = setOf(
    "com.android.chrome",
    "com.chrome.beta",
    "com.chrome.dev",
    "com.chrome.canary",
    "org.chromium.chrome",
    "com.google.android.apps.chrome",
    "com.microsoft.emmx",
    "com.microsoft.emmx.beta",
    "com.microsoft.emmx.dev",
    "com.microsoft.emmx.canary",
    "org.mozilla.firefox",
    "org.mozilla.firefox_beta",
    "org.mozilla.fenix",
    "org.mozilla.focus",
    "org.mozilla.klar",
    "com.brave.browser",
    "com.brave.browser_beta",
    "com.brave.browser_nightly",
    "com.opera.browser",
    "com.opera.browser.beta",
    "com.opera.mini.native",
    "com.opera.gx",
    "com.sec.android.app.sbrowser",
    "com.sec.android.app.sbrowser.beta",
    "com.duckduckgo.mobile.android",
    "com.vivaldi.browser",
    "com.kiwibrowser.browser",
    "com.yandex.browser",
    "com.ecosia.android",
    "com.vivo.browser",
    "com.heytap.browser",
    "com.coloros.browser",
    "com.android.browser",
    "com.mi.globalbrowser",
    "com.huawei.browser",
    "com.UCMobile.intl",
  ).mapTo(HashSet()) { it.lowercase() }

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
      if (target != null) {
        // Exact host first, then a parent domain, then any host on the same
        // main domain. Apps and mobile sites often use another subdomain than
        // the one saved from the desktop site (m.example.com, app.example.com).
        when (login.hosts.maxOfOrNull { siteTier(target, it) } ?: 0) {
          3 -> explicit = maxOf(explicit, 95)
          2 -> explicit = maxOf(explicit, 90)
          1 -> explicit = maxOf(explicit, DEFINITE_SCORE)
        }
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

  /**
   * Returns the logins to offer, best first.
   *
   * - When any login matches by package or web domain, logins guessed from the
   *   app name are dropped. Otherwise a page with one exact match also showed
   *   every login that happened to share a word with the app.
   * - [typed] is what the user already entered in the username field. Only
   *   logins whose username starts with it are kept (the same case-insensitive
   *   prefix rule Android applies while the user keeps typing), so the right
   *   account survives the [limit] cap on sites with hundreds of logins.
   */
  fun rank(
    logins: List<AutofillLogin>,
    webDomain: String?,
    packageName: String?,
    targetTokens: Set<String>,
    typed: String? = null,
    limit: Int = MAX_DATASETS,
  ): List<AutofillLogin> {
    val scored = logins.mapIndexedNotNull { index, login ->
      val value = score(login, webDomain, packageName, targetTokens)
      if (value > 0) Triple(login, value, index) else null
    }
    if (scored.isEmpty()) return emptyList()
    val definite = scored.any { it.second >= DEFINITE_SCORE }
    val pool = if (definite) scored.filter { it.second >= DEFINITE_SCORE } else scored
    val query = typed?.trim()?.lowercase()?.ifEmpty { null }
    val narrowed = if (query == null) {
      pool
    } else {
      pool.filter { matchesTyped(it.first, query) }
    }
    return narrowed
      .sortedWith(
        compareByDescending<Triple<AutofillLogin, Int, Int>> { it.second }
          .thenBy { if (query != null && it.first.username?.trim()?.lowercase() == query) 0 else 1 }
          .thenBy { it.third },
      )
      .take(limit.coerceAtLeast(0))
      .map { it.first }
  }

  /** Case-insensitive username prefix, matching Android's dataset filter. */
  fun matchesTyped(login: AutofillLogin, typed: String?): Boolean {
    val query = typed?.trim()?.lowercase()?.ifEmpty { null } ?: return true
    val username = login.username?.trim()?.lowercase()?.ifEmpty { null } ?: return false
    return username.startsWith(query)
  }

  /**
   * How a page or app domain relates to a saved host: 3 = same host, 2 = the
   * target is a subdomain of the saved host, 1 = both share a main
   * (registrable) domain, 0 = unrelated. Look-alikes such as
   * `example.com.evil.test` are unrelated, and hosts under a shared hosting
   * suffix (`alice.github.io`, `bob.github.io`) never share a main domain.
   */
  fun siteTier(targetDomain: String, savedHost: String): Int {
    val target = normaliseHost(targetDomain) ?: return 0
    val saved = normaliseHost(savedHost) ?: return 0
    if (saved != "localhost" && !saved.contains('.')) return 0
    if (target == saved) return 3
    if (target.endsWith(".$saved")) return 2
    val targetMain = mainDomain(target) ?: return 0
    return if (targetMain == mainDomain(saved)) 1 else 0
  }

  /** True when [siteTier] finds any relation. */
  fun siteMatches(targetDomain: String, savedHost: String): Boolean =
    siteTier(targetDomain, savedHost) > 0

  /**
   * The registrable domain of [host]: `accounts.example.co.uk` gives
   * `example.co.uk`, `m.reddit.com` gives `reddit.com`. Uses a small built-in
   * list of country second-level domains and shared hosting suffixes instead of
   * the full Public Suffix List. IP addresses and `localhost` return
   * themselves; a bare public suffix returns null.
   */
  fun mainDomain(host: String): String? {
    val normalised = normaliseHost(host) ?: return null
    if (normalised == "localhost" || isIpAddress(normalised)) return normalised
    val labels = normalised.split('.').filter { it.isNotEmpty() }
    if (labels.size < 2) return null
    SHARED_SUFFIXES.firstOrNull { normalised == it || normalised.endsWith(".$it") }?.let { suffix ->
      val size = suffix.count { it == '.' } + 2
      return if (labels.size >= size) labels.takeLast(size).joinToString(".") else null
    }
    val tld = labels.last()
    val second = labels[labels.size - 2]
    val countrySecondLevel = tld.length == 2 && second in COUNTRY_SECOND_LEVEL
    if (countrySecondLevel && labels.size == 2) return null
    val size = if (countrySecondLevel) 3 else 2
    return labels.takeLast(size).joinToString(".")
  }

  /**
   * Whether a native app's package name places it under [webDomain]'s main
   * domain: `com.reddit.frontpage` owns `m.reddit.com`, `uk.co.bbc.news` owns
   * `bbc.co.uk`. Android does not verify package names, so this is weaker than
   * a verified app link; it only decides whether an app's reported web domain
   * is used for matching at all.
   */
  fun packageOwnsDomain(packageName: String?, webDomain: String?): Boolean {
    if (packageName.isNullOrBlank() || webDomain.isNullOrBlank()) return false
    val main = mainDomain(webDomain) ?: return false
    if (main == "localhost" || isIpAddress(main)) return false
    val labels = packageName.trim().lowercase().split('.').filter { it.isNotEmpty() }
    for (count in 2..labels.size) {
      val candidate = labels.take(count).reversed().joinToString(".")
      if (mainDomain(candidate) == main) return true
    }
    return false
  }

  private fun isIpAddress(host: String): Boolean =
    host.contains(':') || host.all { it.isDigit() || it == '.' }

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
