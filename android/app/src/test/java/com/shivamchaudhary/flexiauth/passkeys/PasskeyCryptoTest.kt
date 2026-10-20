package com.shivamchaudhary.flexiauth.passkeys

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PasskeyCryptoTest {
  private fun creationOptions() = PasskeyCreationOptions(
    challenge = "Y2hhbGxlbmdl",
    rpId = "example.com",
    rpName = "Example",
    userId = "dXNlci0x",
    userName = "me@example.com",
    userDisplayName = "Example account",
    excludeCredentialIds = emptyList(),
  )

  private fun getOptions() = PasskeyGetOptions(
    challenge = "Y2hhbGxlbmdl",
    rpId = "example.com",
    allowCredentialIds = emptyList(),
    userVerification = "required",
  )

  @Test
  fun base64UrlRoundTripsWithoutPadding() {
    val bytes = ByteArray(32) { (it * 7).toByte() }
    val encoded = PasskeyCrypto.base64UrlEncode(bytes)
    assertFalse(encoded.contains('='))
    assertArrayEquals(bytes, PasskeyCrypto.base64UrlDecode(encoded))
    assertEquals(encoded, PasskeyCrypto.normaliseBase64Url(encoded))
    assertNull(PasskeyCrypto.normaliseBase64Url("not valid!"))
  }

  @Test
  fun registrationAuthDataHasEs256CoseKeyAndAttestedCredential() {
    val credentialId = ByteArray(16) { (it + 1).toByte() }
    val publicX = ByteArray(32) { (it + 2).toByte() }
    val publicY = ByteArray(32) { (it + 3).toByte() }
    val authData = PasskeyCrypto.registrationAuthData(
      "example.com",
      credentialId,
      publicX,
      publicY,
    )

    assertArrayEquals(
      PasskeyCrypto.sha256("example.com".toByteArray()),
      authData.copyOfRange(0, 32),
    )
    assertEquals(0x5D, authData[32].toInt() and 0xFF)
    for (index in 33..36) {
      assertEquals(0, authData[index].toInt())
    }
    for (index in 37..52) {
      assertEquals(0, authData[index].toInt())
    }
    assertEquals(0, authData[53].toInt())
    assertEquals(16, authData[54].toInt())
    assertArrayEquals(credentialId, authData.copyOfRange(55, 71))
    assertEquals(0xA5, authData[71].toInt() and 0xFF)
    assertTrue(authData.size > 100)
  }

  @Test
  fun assertionAuthDataUsesZeroCounterAndBackupFlags() {
    val authData = PasskeyCrypto.assertionAuthData("example.com")
    assertEquals(37, authData.size)
    assertEquals(0x1D, authData[32].toInt() and 0xFF)
    assertEquals(0, authData[33].toInt())
    assertEquals(0, authData[34].toInt())
    assertEquals(0, authData[35].toInt())
    assertEquals(0, authData[36].toInt())
  }

  @Test
  fun generatedKeySignsAndVerifies() {
    val key = PasskeyCrypto.generateKeyMaterial()
    val data = "authenticator data".toByteArray()
    val signature = PasskeyCrypto.sign(key.privateKey, data)

    assertTrue(PasskeyCrypto.verify(key.publicX, key.publicY, data, signature))
    assertFalse(
      PasskeyCrypto.verify(
        key.publicX,
        key.publicY,
        "different data".toByteArray(),
        signature,
      )
    )
  }

  @Test
  fun registrationResponseContainsAttestationNoneAndCredentialId() {
    val options = creationOptions()
    val credential = PasskeyCrypto.createCredential(options, "vault-item-1", 123L)
    val json = JSONObject(
      PasskeyCrypto.registrationResponseJson(
        credential,
        options,
        null,
        "android:apk-key-hash:test",
      )
    )

    assertEquals(credential.credentialId, json.getString("id"))
    assertEquals(credential.credentialId, json.getString("rawId"))
    assertEquals("public-key", json.getString("type"))
    val response = json.getJSONObject("response")
    val clientData = String(
      PasskeyCrypto.base64UrlDecode(response.getString("clientDataJSON")),
      Charsets.UTF_8,
    )
    assertTrue(clientData.contains("webauthn.create"))
    assertTrue(clientData.contains("Y2hhbGxlbmdl"))
    assertTrue(clientData.contains("android:apk-key-hash:test"))

    val attestation = PasskeyCrypto.base64UrlDecode(
      response.getString("attestationObject")
    )
    assertEquals(0xA3, attestation[0].toInt() and 0xFF)
    assertTrue(String(attestation, Charsets.ISO_8859_1).contains("none"))
  }

  @Test
  fun privilegedBrowserResponsesLeaveClientDataJsonForTheBrowser() {
    val options = creationOptions()
    val credential = PasskeyCrypto.createCredential(options, "vault-item-1", 123L)
    val hash = PasskeyCrypto.sha256("browser-client-data".toByteArray())
    val json = JSONObject(
      PasskeyCrypto.registrationResponseJson(
        credential,
        options,
        hash,
        "https://example.com",
      )
    )
    assertEquals("", json.getJSONObject("response").getString("clientDataJSON"))
  }

  @Test
  fun assertionSignatureCoversAuthenticatorDataAndClientDataHash() {
    val options = creationOptions()
    val credential = PasskeyCrypto.createCredential(options, "vault-item-1", 123L)
    val hash = PasskeyCrypto.sha256("browser-client-data".toByteArray())
    val json = JSONObject(
      PasskeyCrypto.assertionResponseJson(
        credential,
        getOptions(),
        hash,
        "https://example.com",
      )
    )
    val response = json.getJSONObject("response")
    assertEquals("", response.getString("clientDataJSON"))
    val authData = PasskeyCrypto.base64UrlDecode(
      response.getString("authenticatorData")
    )
    val signature = PasskeyCrypto.base64UrlDecode(response.getString("signature"))
    assertTrue(
      PasskeyCrypto.verify(
        PasskeyCrypto.base64UrlDecode(credential.publicKeyX),
        PasskeyCrypto.base64UrlDecode(credential.publicKeyY),
        authData + hash,
        signature,
      )
    )
  }

  @Test
  fun assertionSignatureCoversHashedNativeClientData() {
    val options = creationOptions()
    val credential = PasskeyCrypto.createCredential(options, "vault-item-1", 123L)
    val json = JSONObject(
      PasskeyCrypto.assertionResponseJson(
        credential,
        getOptions(),
        null,
        "android:apk-key-hash:test",
      )
    )
    val response = json.getJSONObject("response")
    val clientData = PasskeyCrypto.base64UrlDecode(
      response.getString("clientDataJSON")
    )
    val authData = PasskeyCrypto.base64UrlDecode(
      response.getString("authenticatorData")
    )
    val signature = PasskeyCrypto.base64UrlDecode(response.getString("signature"))
    assertTrue(
      PasskeyCrypto.verify(
        PasskeyCrypto.base64UrlDecode(credential.publicKeyX),
        PasskeyCrypto.base64UrlDecode(credential.publicKeyY),
        authData + PasskeyCrypto.sha256(clientData),
        signature,
      )
    )
    assertTrue(String(clientData, Charsets.UTF_8).contains("webauthn.get"))
  }

  @Test
  fun parsesCreationAndGetRequests() {
    val creation = PasskeyRequestParser.parseCreation(
      """
      {
        "challenge": "Y2hhbGxlbmdl",
        "rp": { "id": "example.com", "name": "Example" },
        "user": {
          "id": "dXNlci0x",
          "name": "me@example.com",
          "displayName": "Example account"
        },
        "pubKeyCredParams": [
          { "type": "public-key", "alg": -7 }
        ],
        "excludeCredentials": [
          { "type": "public-key", "id": "credential-1" }
        ]
      }
      """.trimIndent()
    )
    assertNotNull(creation)
    assertEquals("example.com", creation?.rpId)
    assertEquals("me@example.com", creation?.userName)
    assertEquals(listOf("credential-1"), creation?.excludeCredentialIds)

    val get = PasskeyRequestParser.parseGet(
      """
      {
        "challenge": "Y2hhbGxlbmdl",
        "rpId": "example.com",
        "allowCredentials": [
          { "type": "public-key", "id": "credential-1" }
        ]
      }
      """.trimIndent()
    )
    assertNotNull(get)
    assertEquals("example.com", get?.rpId)
    assertEquals(listOf("credential-1"), get?.allowCredentialIds)
  }

  @Test
  fun rejectsUnsupportedAlgorithmsAndInvalidRpIds() {
    val unsupported = PasskeyRequestParser.parseCreation(
      """
      {
        "challenge": "Y2hhbGxlbmdl",
        "rp": { "id": "example.com" },
        "user": { "id": "dXNlci0x", "name": "me" },
        "pubKeyCredParams": [{ "type": "public-key", "alg": -257 }]
      }
      """.trimIndent()
    )
    assertNull(unsupported)
    assertTrue(PasskeyRequestParser.isRpId("example.com"))
    assertTrue(PasskeyRequestParser.isRpId("localhost"))
    assertFalse(PasskeyRequestParser.isRpId("https://example.com"))
    assertFalse(PasskeyRequestParser.isRpId("example"))
  }
}
