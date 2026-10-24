package com.shivamchaudhary.flexiauth.autofill

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Base64

class AutofillUnlockCryptoTest {
  private val salt = "KioqKioqKioqKioqKioqKg=="
  private val check = "43lglOJPoPsTX1baVBW2AYyuGfRuOOi3xtYuJX+k/zM="
  private val envelope = "v1.BwcHBwcHBwcHBwcH.SLEUSEbYOf4RfPO6CDzkBCrxHv3Y1M3MsAKGcea1NdgydLzhqMisEr+m6CpZY4JT4zB4fOIoBrFbbuV4W0rk"

  @Test fun matchesJavaScriptPbkdf2AndNfkcNormalization() {
    val key = AutofillUnlockCrypto.derive("passé１２３", salt, 210000, check)
    try {
      assertEquals("MW7MYi7nYJ+aao8tPUGwLveGXAGCvmpa9nBx8tsoxhA=", Base64.getEncoder().encodeToString(key))
      assertEquals("{\"id\":\"login-vector\",\"password\":\"café-secret\"}", AutofillUnlockCrypto.decrypt(key, envelope))
    } finally { key.fill(0) }
  }

  @Test fun rejectsIncorrectMasterPassword() {
    assertThrows(IllegalArgumentException::class.java) {
      AutofillUnlockCrypto.derive("wrong", salt, 210000, check)
    }
  }

  @Test fun rejectsTamperedCiphertextAndUnsupportedEnvelopes() {
    val key = AutofillUnlockCrypto.derive("passé123", salt, 210000, check)
    try {
      assertThrows(Exception::class.java) {
        AutofillUnlockCrypto.decrypt(key, envelope.dropLast(1) + "A")
      }
      assertThrows(IllegalArgumentException::class.java) {
        AutofillUnlockCrypto.decrypt(key, "v2.bad.envelope")
      }
    } finally { key.fill(0) }
  }

  @Test fun boundsKdfWorkAndRequiresARealSalt() {
    assertThrows(IllegalArgumentException::class.java) {
      AutofillUnlockCrypto.derive("password", salt, 0, check)
    }
    assertThrows(IllegalArgumentException::class.java) {
      AutofillUnlockCrypto.derive("password", salt, 2000001, check)
    }
    assertThrows(IllegalArgumentException::class.java) {
      AutofillUnlockCrypto.derive("password", "AA==", 1, check)
    }
  }
}
