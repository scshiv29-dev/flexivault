package com.shivamchaudhary.flexiauth.passkeys

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PasskeyOriginTest {
  @Test
  fun webOriginsRequireHttpsOrLoopbackHttp() {
    assertTrue(PasskeyOrigin.isWebOrigin("https://example.com"))
    assertTrue(PasskeyOrigin.isWebOrigin("https://login.example.com:8443"))
    assertTrue(PasskeyOrigin.isWebOrigin("http://localhost:3000"))
    assertTrue(PasskeyOrigin.isWebOrigin("http://127.0.0.1:8080"))
    assertFalse(PasskeyOrigin.isWebOrigin("http://example.com"))
    assertFalse(PasskeyOrigin.isWebOrigin("android:apk-key-hash:abc"))
    assertFalse(PasskeyOrigin.isWebOrigin(""))
  }

  @Test
  fun rpIdMustEqualOriginHostOrBeItsParent() {
    assertTrue(PasskeyOrigin.matchesRpId("https://example.com", "example.com"))
    assertTrue(PasskeyOrigin.matchesRpId("https://login.example.com", "example.com"))
    assertFalse(PasskeyOrigin.matchesRpId("https://example.com", "login.example.com"))
    assertFalse(PasskeyOrigin.matchesRpId("https://example.com.evil.test", "example.com"))
    assertFalse(PasskeyOrigin.matchesRpId("https://badexample.com", "example.com"))
    assertFalse(PasskeyOrigin.matchesRpId("http://example.com", "example.com"))
  }

  @Test
  fun nativeOriginsUseTheApkKeyHashScheme() {
    assertTrue(PasskeyOrigin.isNativeOrigin("android:apk-key-hash:abc123"))
    assertFalse(PasskeyOrigin.isNativeOrigin("android:apk-key-hash:"))
    assertFalse(PasskeyOrigin.isNativeOrigin("https://example.com"))
  }

  @Test
  fun browserCallersMustMatchThePrivilegedOrigin() {
    val hash = ByteArray(32) { 1 }
    assertTrue(
      PasskeyOrigin.isAllowedCaller(hash, "https://login.example.com", "example.com")
    )
    assertFalse(
      PasskeyOrigin.isAllowedCaller(hash, "https://example.com.evil.test", "example.com")
    )
    assertFalse(PasskeyOrigin.isAllowedCaller(hash, "", "example.com"))
  }

  @Test
  fun nativeCallersUseTheApkHashPath() {
    val origin = "android:apk-key-hash:abc123"
    assertTrue(PasskeyOrigin.isAllowedCaller(null, origin, "example.com"))
    assertFalse(PasskeyOrigin.isAllowedCaller(null, "", "example.com"))
  }
}
