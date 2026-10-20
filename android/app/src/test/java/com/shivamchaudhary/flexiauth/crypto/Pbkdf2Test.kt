package com.shivamchaudhary.flexiauth.crypto

import org.junit.Assert.assertEquals
import org.junit.Test

class Pbkdf2Test {
  private fun hex(bytes: ByteArray): String {
    return bytes.joinToString("") { byte ->
      (byte.toInt() and 0xff).toString(16).padStart(2, '0')
    }
  }

  @Test
  fun matchesKnownSha256Vectors() {
    assertEquals(
      "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
      hex(Pbkdf2.derive("password".toByteArray(), "salt".toByteArray(), 1, 32))
    )
    assertEquals(
      "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
      hex(Pbkdf2.derive("password".toByteArray(), "salt".toByteArray(), 2, 32))
    )
    assertEquals(
      "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
      hex(Pbkdf2.derive("password".toByteArray(), "salt".toByteArray(), 4096, 32))
    )
  }

  @Test
  fun derivesBothOutputBlocks() {
    assertEquals(
      "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a" +
        "f7ad98c1b458ce3fd74ca35beba3cda7b8d1038d6a87071b918f837405f3fe77",
      hex(Pbkdf2.derive("password".toByteArray(), "salt".toByteArray(), 4096, 64))
    )
  }

  @Test
  fun handlesUnicodeAtTheVaultIterationCount() {
    assertEquals(
      "acb7b8188efe7e2741f209e3a22d0e491d8e91f6fbc284b16e72a2413212e4f4" +
        "3f96c9d6256189b49f9a51d28d78cf65686bd4aea4044ba0cb43b548cee0267b",
      hex(
        Pbkdf2.derive(
          "pässwörd🔐".toByteArray(Charsets.UTF_8),
          "FlexiVaultSalt01".toByteArray(Charsets.UTF_8),
          210_000,
          64,
        )
      )
    )
  }
}
