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
}
