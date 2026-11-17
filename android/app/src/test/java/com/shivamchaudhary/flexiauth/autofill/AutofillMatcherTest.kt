package com.shivamchaudhary.flexiauth.autofill

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutofillMatcherTest {
  private fun login(
    name: String = "Reddit",
    username: String? = "me",
    password: String = "secret",
    hosts: List<String> = listOf("reddit.com"),
    packages: List<String> = emptyList(),
  ): AutofillLogin {
    return AutofillLogin("id", name, username, password, hosts, packages)
  }

  @Test
  fun matchesExplicitPackagesAndWebDomains() {
    val appLogin = login(packages = listOf("com.reddit.frontpage"))
    assertEquals(
      100,
      AutofillMatcher.score(
        appLogin,
        webDomain = null,
        packageName = "com.reddit.frontpage",
        targetTokens = emptySet(),
      ),
    )

    val webLogin = login()
    assertEquals(
      90,
      AutofillMatcher.score(
        webLogin,
        webDomain = "accounts.reddit.com",
        packageName = "com.android.chrome",
        targetTokens = AutofillMatcher.targetTokens("com.android.chrome", "Chrome"),
      ),
    )
  }

  @Test
  fun rejectsLookalikeDomains() {
    assertTrue(AutofillMatcher.hostMatches("accounts.reddit.com", "reddit.com"))
    assertFalse(AutofillMatcher.hostMatches("reddit.com.evil.test", "reddit.com"))
    assertEquals(
      0,
      AutofillMatcher.score(
        login(),
        webDomain = "reddit.com.evil.test",
        packageName = "com.android.chrome",
        targetTokens = AutofillMatcher.targetTokens("com.android.chrome", "Chrome"),
      ),
    )
  }

  @Test
  fun infersNativeAppFromPackageTokens() {
    val target = AutofillMatcher.targetTokens("com.reddit.frontpage", "Reddit")
    assertTrue(
      AutofillMatcher.score(
        login(hosts = emptyList()),
        webDomain = null,
        packageName = "com.reddit.frontpage",
        targetTokens = target,
      ) > 0,
    )
  }

  @Test
  fun infersGmailFromTheAppLabel() {
    val target = AutofillMatcher.targetTokens("com.google.android.gm", "Gmail")
    assertTrue(
      AutofillMatcher.score(
        login(name = "Gmail", hosts = listOf("gmail.com")),
        webDomain = null,
        packageName = "com.google.android.gm",
        targetTokens = target,
      ) > 0,
    )
  }

  @Test
  fun matchesShortBrandAliases() {
    val target = AutofillMatcher.targetTokens("com.twitter.android", "X")
    assertTrue(
      AutofillMatcher.score(
        login(name = "X", hosts = listOf("x.com")),
        webDomain = null,
        packageName = "com.twitter.android",
        targetTokens = target,
      ) > 0,
    )
  }

  @Test
  fun doesNotInferFromTheBrowserPackage() {
    val target = AutofillMatcher.targetTokens("com.android.chrome", "Chrome")
    assertEquals(
      0,
      AutofillMatcher.score(
        login(name = "Google", hosts = listOf("google.com")),
        webDomain = "example.com",
        packageName = "com.android.chrome",
        targetTokens = target,
      ),
    )
  }

  @Test
  fun infersNativeAppsWithWebViewDomains() {
    val target = AutofillMatcher.targetTokens("com.reddit.frontpage", "Reddit")
    assertTrue(
      AutofillMatcher.score(
        login(hosts = emptyList()),
        webDomain = "accounts.reddit.com",
        packageName = "com.reddit.frontpage",
        targetTokens = target,
      ) > 0,
    )
  }

  @Test
  fun ignoresExplicitBrowserPackageOnWebForms() {
    assertEquals(
      0,
      AutofillMatcher.score(
        login(packages = listOf("com.android.chrome")),
        webDomain = "example.com",
        packageName = "com.android.chrome",
        targetTokens = AutofillMatcher.targetTokens("com.android.chrome", "Chrome"),
      ),
    )
  }

  @Test
  fun ignoresGenericNameTokens() {
    val target = AutofillMatcher.targetTokens("com.example.mobile", "App")
    assertEquals(
      0,
      AutofillMatcher.score(
        login(name = "Mobile App", hosts = emptyList()),
        webDomain = null,
        packageName = "com.example.mobile",
        targetTokens = target,
      ),
    )
  }

  @Test
  fun recognisesBrowserPackages() {
    assertTrue(AutofillMatcher.isBrowserPackage("com.android.chrome"))
    assertTrue(AutofillMatcher.isBrowserPackage("com.microsoft.emmx"))
    assertTrue(AutofillMatcher.isBrowserPackage("org.mozilla.firefox"))
    assertFalse(AutofillMatcher.isBrowserPackage("com.reddit.frontpage"))
    assertFalse(AutofillMatcher.isBrowserPackage(null))
  }

  private fun entry(
    id: String,
    name: String = id,
    username: String? = "$id@example.com",
    hosts: List<String> = listOf("example.com"),
    packages: List<String> = emptyList(),
  ) = AutofillLogin(id, name, username, "pw-$id", hosts, packages)

  private val chromeTokens = AutofillMatcher.targetTokens("com.android.chrome", "Chrome")

  @Test
  fun recognisesPhoneMakerAndFirefoxBrowsers() {
    assertTrue(AutofillMatcher.isBrowserPackage("com.vivo.browser"))
    assertTrue(AutofillMatcher.isBrowserPackage("org.mozilla.fenix"))
    assertTrue(AutofillMatcher.isBrowserPackage("com.sec.android.app.sbrowser"))
    assertTrue(AutofillMatcher.isBrowserPackage("com.UCMobile.intl"))
    // vivo's browser used to be treated as a native app called "Browser", so
    // logins were guessed from its name instead of the page's domain.
    val vivo = AutofillMatcher.targetTokens("com.vivo.browser", "vivo Browser")
    assertEquals(
      0,
      AutofillMatcher.score(
        entry("vivo account", name = "vivo account", hosts = listOf("vivo.com")),
        webDomain = "github.com",
        packageName = "com.vivo.browser",
        targetTokens = vivo,
      ),
    )
  }

  @Test
  fun exactHostRanksAboveParentDomain() {
    val parent = entry("parent", hosts = listOf("google.com"))
    val exact = entry("exact", hosts = listOf("mail.google.com"))
    val ranked = AutofillMatcher.rank(
      listOf(parent, exact),
      webDomain = "mail.google.com",
      packageName = "com.android.chrome",
      targetTokens = chromeTokens,
    )
    assertEquals(listOf("exact", "parent"), ranked.map { it.id })
  }

  @Test
  fun definiteMatchesHideAppNameGuesses() {
    val target = AutofillMatcher.targetTokens("com.reddit.frontpage", "Reddit")
    val explicit = entry("app", name = "Reddit", hosts = emptyList(),
      packages = listOf("com.reddit.frontpage"))
    val guessed = entry("guess", name = "Reddit old", hosts = emptyList())
    val ranked = AutofillMatcher.rank(
      listOf(guessed, explicit),
      webDomain = null,
      packageName = "com.reddit.frontpage",
      targetTokens = target,
    )
    assertEquals(listOf("app"), ranked.map { it.id })

    // With no definite match, the app-name guess is still offered.
    val onlyGuess = AutofillMatcher.rank(
      listOf(guessed),
      webDomain = null,
      packageName = "com.reddit.frontpage",
      targetTokens = target,
    )
    assertEquals(listOf("guess"), onlyGuess.map { it.id })
  }

  @Test
  fun webDomainMatchHidesTokenGuessesInWebViewApps() {
    val target = AutofillMatcher.targetTokens("com.example.shop", "Example Shop")
    val web = entry("web", name = "Shop login", hosts = listOf("shop.example.com"))
    val guess = entry("guess", name = "Example Shop staff", hosts = emptyList())
    val ranked = AutofillMatcher.rank(
      listOf(guess, web),
      webDomain = "shop.example.com",
      packageName = "com.example.shop",
      targetTokens = target,
    )
    assertEquals(listOf("web"), ranked.map { it.id })
  }

  @Test
  fun typedUsernameNarrowsHundredsOfLogins() {
    val logins = (1..300).map { entry("user%03d".format(it)) }
    val all = AutofillMatcher.rank(
      logins,
      webDomain = "example.com",
      packageName = "com.android.chrome",
      targetTokens = chromeTokens,
    )
    assertEquals(AutofillMatcher.MAX_DATASETS, all.size)
    assertFalse("user257 is past the cap", all.any { it.id == "user257" })

    val typed = AutofillMatcher.rank(
      logins,
      webDomain = "example.com",
      packageName = "com.android.chrome",
      targetTokens = chromeTokens,
      typed = "  USER25 ",
    )
    assertEquals((250..259).map { "user%03d".format(it) }, typed.map { it.id })

    val exact = AutofillMatcher.rank(
      logins,
      webDomain = "example.com",
      packageName = "com.android.chrome",
      targetTokens = chromeTokens,
      typed = "user257@example.com",
    )
    assertEquals(listOf("user257"), exact.map { it.id })
  }

  @Test
  fun typedTextThatMatchesNoUsernameOffersNothing() {
    val logins = listOf(entry("ada"), entry("grace"), entry("blank", username = null))
    val ranked = AutofillMatcher.rank(
      logins,
      webDomain = "example.com",
      packageName = "com.android.chrome",
      targetTokens = chromeTokens,
      typed = "newperson@",
    )
    assertTrue(ranked.isEmpty())
    assertFalse(AutofillMatcher.matchesTyped(entry("blank", username = null), "a"))
    assertTrue(AutofillMatcher.matchesTyped(entry("blank", username = null), "  "))
  }

  @Test
  fun typedFilterKeepsSiteMatchingRules() {
    val lookalike = entry("evil", hosts = listOf("example.com.evil.test"))
    val ranked = AutofillMatcher.rank(
      listOf(lookalike),
      webDomain = "example.com",
      packageName = "com.android.chrome",
      targetTokens = chromeTokens,
      typed = "evil",
    )
    assertTrue(ranked.isEmpty())
  }

  @Test
  fun findsTheMainDomain() {
    assertEquals("reddit.com", AutofillMatcher.mainDomain("m.reddit.com"))
    assertEquals("reddit.com", AutofillMatcher.mainDomain("https://www.reddit.com/login"))
    assertEquals("example.co.uk", AutofillMatcher.mainDomain("accounts.example.co.uk"))
    assertEquals("example.com.au", AutofillMatcher.mainDomain("login.example.com.au"))
    assertEquals(null, AutofillMatcher.mainDomain("co.uk"))
    assertEquals("alice.github.io", AutofillMatcher.mainDomain("docs.alice.github.io"))
    assertEquals(null, AutofillMatcher.mainDomain("github.io"))
    assertEquals("localhost", AutofillMatcher.mainDomain("localhost"))
    assertEquals("192.168.1.10", AutofillMatcher.mainDomain("192.168.1.10"))
  }

  @Test
  fun relatesHostsOnTheSameMainDomain() {
    assertEquals(3, AutofillMatcher.siteTier("reddit.com", "www.reddit.com"))
    assertEquals(2, AutofillMatcher.siteTier("m.reddit.com", "reddit.com"))
    assertEquals(1, AutofillMatcher.siteTier("app.reddit.com", "accounts.reddit.com"))
    assertEquals(1, AutofillMatcher.siteTier("reddit.com", "accounts.reddit.com"))
    assertEquals(0, AutofillMatcher.siteTier("alice.github.io", "bob.github.io"))
    assertEquals(0, AutofillMatcher.siteTier("example.co.uk", "other.co.uk"))
    assertEquals(0, AutofillMatcher.siteTier("reddit.com.evil.test", "reddit.com"))
    assertEquals(0, AutofillMatcher.siteTier("evilreddit.com", "reddit.com"))
  }

  @Test
  fun appWebViewOnAnotherSubdomainMatchesTheSavedSite() {
    val target = AutofillMatcher.targetTokens("com.reddit.frontpage", "Reddit")
    val saved = entry("web", name = "My account", hosts = listOf("accounts.reddit.com"))
    assertEquals(
      AutofillMatcher.DEFINITE_SCORE,
      AutofillMatcher.score(saved, "m.reddit.com", "com.reddit.frontpage", target),
    )
    // A browser page on a sibling subdomain matches the same way.
    assertEquals(
      AutofillMatcher.DEFINITE_SCORE,
      AutofillMatcher.score(saved, "www.reddit.com", "com.android.chrome", chromeTokens),
    )
  }

  @Test
  fun ranksExactThenParentThenMainDomain() {
    val sibling = entry("sibling", hosts = listOf("accounts.example.com"))
    val parent = entry("parent", hosts = listOf("example.com"))
    val exact = entry("exact", hosts = listOf("app.example.com"))
    val ranked = AutofillMatcher.rank(
      listOf(sibling, parent, exact),
      webDomain = "app.example.com",
      packageName = "com.android.chrome",
      targetTokens = chromeTokens,
    )
    assertEquals(listOf("exact", "parent", "sibling"), ranked.map { it.id })
  }

  @Test
  fun appOwnsDomainsUnderItsPackageName() {
    assertTrue(AutofillMatcher.packageOwnsDomain("com.reddit.frontpage", "m.reddit.com"))
    assertTrue(AutofillMatcher.packageOwnsDomain("com.google.android.gm", "accounts.google.com"))
    assertTrue(AutofillMatcher.packageOwnsDomain("uk.co.bbc.news", "account.bbc.co.uk"))
    assertTrue(AutofillMatcher.packageOwnsDomain("io.github.alice.notes", "alice.github.io"))
    assertFalse(AutofillMatcher.packageOwnsDomain("io.github.alice.notes", "bob.github.io"))
    assertFalse(AutofillMatcher.packageOwnsDomain("com.evil.wallet", "paypal.com"))
    assertFalse(AutofillMatcher.packageOwnsDomain("com.paypalhelper.app", "paypal.com"))
    assertFalse(AutofillMatcher.packageOwnsDomain("co.uk.something", "example.co.uk"))
    assertFalse(AutofillMatcher.packageOwnsDomain("com.example.app", null))
  }
}
