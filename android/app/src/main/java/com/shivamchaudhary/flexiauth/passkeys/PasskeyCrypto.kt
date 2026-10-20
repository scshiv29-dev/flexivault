package com.shivamchaudhary.flexiauth.passkeys

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import java.util.Base64

/**
 * Minimal WebAuthn authenticator implementation for synced P-256 passkeys.
 *
 * Attestation is intentionally `fmt: "none"`: FlexiVault cannot make a hardware
 * attestation statement for a key that is encrypted and synced through the
 * user's vault. The RP still receives a normal ES256 credential public key and
 * every assertion is signed by the private scalar stored in the vault.
 */
object PasskeyCrypto {
  private const val FLAG_UP = 0x01
  private const val FLAG_UV = 0x04
  private const val FLAG_BE = 0x08
  private const val FLAG_BS = 0x10
  private const val FLAG_AT = 0x40

  private val urlEncoder: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()
  private val urlDecoder: Base64.Decoder = Base64.getUrlDecoder()
  private val random = SecureRandom()

  data class KeyMaterial(
    val privateKey: ByteArray,
    val publicX: ByteArray,
    val publicY: ByteArray,
  )

  fun base64UrlEncode(bytes: ByteArray): String = urlEncoder.encodeToString(bytes)

  fun base64UrlDecode(value: String): ByteArray {
    val normalised = value
      .trim()
      .replace('+', '-')
      .replace('/', '_')
      .trimEnd('=')
    require(normalised.length <= 16_384) { "Encoded value is too large." }
    require(normalised.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
      "Invalid base64url value."
    }
    return urlDecoder.decode(normalised)
  }

  fun normaliseBase64Url(value: String): String? {
    return try {
      val decoded = base64UrlDecode(value)
      if (decoded.isEmpty()) "" else base64UrlEncode(decoded)
    } catch (_: Exception) {
      null
    }
  }

  fun sha256(value: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").digest(value)

  fun generateKeyMaterial(): KeyMaterial {
    val generator = KeyPairGenerator.getInstance("EC")
    generator.initialize(ECGenParameterSpec("secp256r1"), random)
    return keyMaterial(generator.generateKeyPair())
  }

  fun keyMaterial(pair: KeyPair): KeyMaterial {
    val private = pair.private as? ECPrivateKey
      ?: throw IllegalArgumentException("The passkey key is not an EC private key.")
    val public = pair.public as? ECPublicKey
      ?: throw IllegalArgumentException("The passkey key is not an EC public key.")
    return KeyMaterial(
      privateKey = fixed32(private.s),
      publicX = fixed32(public.w.affineX),
      publicY = fixed32(public.w.affineY),
    )
  }

  fun sign(privateKey: ByteArray, data: ByteArray): ByteArray {
    require(privateKey.size == 32) { "A P-256 private key must be 32 bytes." }
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initSign(privateKey(privateKey))
    signature.update(data)
    return signature.sign()
  }

  fun verify(
    publicX: ByteArray,
    publicY: ByteArray,
    data: ByteArray,
    derSignature: ByteArray,
  ): Boolean {
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initVerify(publicKey(publicX, publicY))
    signature.update(data)
    return signature.verify(derSignature)
  }

  fun createCredential(
    options: PasskeyCreationOptions,
    vaultItemId: String,
    now: Long = System.currentTimeMillis(),
  ): PasskeyCredential {
    val key = generateKeyMaterial()
    val credentialId = ByteArray(32).also(random::nextBytes)
    return PasskeyCredential(
      vaultItemId = vaultItemId,
      credentialId = base64UrlEncode(credentialId),
      rpId = options.rpId,
      userName = options.userName,
      displayName = options.userDisplayName,
      userHandle = options.userId,
      privateKey = base64UrlEncode(key.privateKey),
      publicKeyX = base64UrlEncode(key.publicX),
      publicKeyY = base64UrlEncode(key.publicY),
      createdAt = now,
      lastUsedAt = 0L,
      signCount = 0L,
      pending = true,
    )
  }

  fun registrationResponseJson(
    credential: PasskeyCredential,
    options: PasskeyCreationOptions,
    clientDataHash: ByteArray?,
    origin: String,
  ): String {
    val credentialId = base64UrlDecode(credential.credentialId)
    val publicX = base64UrlDecode(credential.publicKeyX)
    val publicY = base64UrlDecode(credential.publicKeyY)
    val authData = registrationAuthData(
      rpId = credential.rpId,
      credentialId = credentialId,
      publicX = publicX,
      publicY = publicY,
    )
    val attestation = cborMap(
      listOf(
        "fmt" to cborText("none"),
        "attStmt" to cborMap(emptyList()),
        "authData" to cborBytes(authData),
      )
    )
    val clientDataJson = clientDataJson(
      type = "webauthn.create",
      challenge = options.challenge,
      origin = origin,
      hasHash = clientDataHash != null,
    )

    return JSONObject()
      .put("id", credential.credentialId)
      .put("rawId", credential.credentialId)
      .put("type", "public-key")
      .put("authenticatorAttachment", "platform")
      .put(
        "response",
        JSONObject()
          .put("clientDataJSON", encodedClientData(clientDataJson))
          .put("attestationObject", base64UrlEncode(attestation))
          .put("transports", JSONArray(listOf("internal")))
      )
      .put("clientExtensionResults", JSONObject())
      .toString()
  }

  fun assertionResponseJson(
    credential: PasskeyCredential,
    options: PasskeyGetOptions,
    clientDataHash: ByteArray?,
    origin: String,
  ): String {
    val authData = assertionAuthData(credential.rpId)
    val clientDataJson = clientDataJson(
      type = "webauthn.get",
      challenge = options.challenge,
      origin = origin,
      hasHash = clientDataHash != null,
    )
    val signedData = if (clientDataHash != null) {
      authData + clientDataHash
    } else {
      authData + sha256(clientDataJson.toByteArray(Charsets.UTF_8))
    }
    val signature = sign(base64UrlDecode(credential.privateKey), signedData)

    val response = JSONObject()
      .put("clientDataJSON", encodedClientData(clientDataJson))
      .put("authenticatorData", base64UrlEncode(authData))
      .put("signature", base64UrlEncode(signature))
    if (credential.userHandle.isNotBlank()) {
      response.put("userHandle", credential.userHandle)
    }

    return JSONObject()
      .put("id", credential.credentialId)
      .put("rawId", credential.credentialId)
      .put("type", "public-key")
      .put("authenticatorAttachment", "platform")
      .put("response", response)
      .put("clientExtensionResults", JSONObject())
      .toString()
  }

  fun registrationAuthData(
    rpId: String,
    credentialId: ByteArray,
    publicX: ByteArray,
    publicY: ByteArray,
  ): ByteArray {
    require(credentialId.size <= 1023) { "Credential ID is too large." }
    val flags = FLAG_UP or FLAG_UV or FLAG_BE or FLAG_BS or FLAG_AT
    val cose = coseKey(publicX, publicY)
    val out = ByteArrayOutputStream()
    out.write(sha256(rpId.toByteArray(Charsets.UTF_8)))
    out.write(flags)
    out.write(0)
    out.write(0)
    out.write(0)
    out.write(0)
    // AAGUID (16 bytes). A software-backed, synced passkey has no AAGUID.
    repeat(16) { out.write(0) }
    out.write((credentialId.size shr 8) and 0xFF)
    out.write(credentialId.size and 0xFF)
    out.write(credentialId)
    out.write(cose)
    return out.toByteArray()
  }

  fun assertionAuthData(rpId: String): ByteArray {
    val flags = FLAG_UP or FLAG_UV or FLAG_BE or FLAG_BS
    val out = ByteArrayOutputStream()
    out.write(sha256(rpId.toByteArray(Charsets.UTF_8)))
    out.write(flags)
    // Synced passkeys use a zero signature counter. RPs that require a
    // monotonically increasing counter must not accept backup-eligible keys.
    out.write(0)
    out.write(0)
    out.write(0)
    out.write(0)
    return out.toByteArray()
  }

  private fun clientDataJson(
    type: String,
    challenge: String,
    origin: String,
    hasHash: Boolean,
  ): String {
    // The Credential Manager contract asks providers to put a placeholder in
    // clientDataJSON for privileged browser calls. The browser replaces it with
    // the JSON it originally hashed; the signature is made over clientDataHash.
    if (hasHash) return ""
    require(origin.isNotBlank()) { "The calling app origin is unavailable." }
    return JSONObject()
      .put("type", type)
      .put("challenge", challenge)
      .put("origin", origin)
      .put("crossOrigin", false)
      .toString()
  }

  private fun encodedClientData(clientDataJson: String): String =
    if (clientDataJson.isEmpty()) {
      ""
    } else {
      base64UrlEncode(clientDataJson.toByteArray(Charsets.UTF_8))
    }

  private fun privateKey(value: ByteArray): PrivateKey {
    val params = p256Params()
    val spec = ECPrivateKeySpec(BigInteger(1, value), params)
    return KeyFactory.getInstance("EC").generatePrivate(spec)
  }

  private fun publicKey(x: ByteArray, y: ByteArray): java.security.PublicKey {
    val point = ECPoint(BigInteger(1, x), BigInteger(1, y))
    val spec = ECPublicKeySpec(point, p256Params())
    return KeyFactory.getInstance("EC").generatePublic(spec)
  }

  private fun p256Params(): ECParameterSpec {
    val parameters = AlgorithmParameters.getInstance("EC")
    parameters.init(ECGenParameterSpec("secp256r1"))
    return parameters.getParameterSpec(ECParameterSpec::class.java)
  }

  private fun fixed32(value: BigInteger): ByteArray {
    val raw = value.toByteArray()
    val source = if (raw.size > 32) raw.copyOfRange(raw.size - 32, raw.size) else raw
    val out = ByteArray(32)
    System.arraycopy(source, 0, out, 32 - source.size, source.size)
    return out
  }

  private fun coseKey(publicX: ByteArray, publicY: ByteArray): ByteArray = cborMap(
    listOf(
      1 to cborInt(2),   // kty: EC2
      3 to cborInt(-7),  // alg: ES256
      -1 to cborInt(1),  // crv: P-256
      -2 to cborBytes(publicX),
      -3 to cborBytes(publicY),
    )
  )

  private fun cborInt(value: Int): ByteArray = cborInt(value.toLong())

  private fun cborInt(value: Long): ByteArray =
    if (value >= 0) cborHeader(0, value) else cborHeader(1, -1L - value)

  private fun cborBytes(value: ByteArray): ByteArray =
    cborHeader(2, value.size.toLong()) + value

  private fun cborText(value: String): ByteArray {
    val bytes = value.toByteArray(Charsets.UTF_8)
    return cborHeader(3, bytes.size.toLong()) + bytes
  }

  private fun cborMap(entries: List<Pair<Any, ByteArray>>): ByteArray {
    val body = ByteArrayOutputStream()
    for ((key, value) in entries) {
      when (key) {
        is Int -> body.write(cborInt(key))
        is Long -> body.write(cborInt(key))
        is String -> body.write(cborText(key))
        else -> throw IllegalArgumentException("Unsupported CBOR map key.")
      }
      body.write(value)
    }
    return cborHeader(5, entries.size.toLong()) + body.toByteArray()
  }

  private fun cborHeader(major: Int, value: Long): ByteArray {
    require(value >= 0) { "CBOR length cannot be negative." }
    val out = ByteArrayOutputStream()
    when {
      value < 24 -> out.write((major shl 5) or value.toInt())
      value < 0x100 -> {
        out.write((major shl 5) or 24)
        out.write(value.toInt())
      }
      value < 0x10000 -> {
        out.write((major shl 5) or 25)
        out.write((value shr 8).toInt() and 0xFF)
        out.write(value.toInt() and 0xFF)
      }
      value < 0x100000000L -> {
        out.write((major shl 5) or 26)
        out.write((value shr 24).toInt() and 0xFF)
        out.write((value shr 16).toInt() and 0xFF)
        out.write((value shr 8).toInt() and 0xFF)
        out.write(value.toInt() and 0xFF)
      }
      else -> {
        out.write((major shl 5) or 27)
        for (shift in 56 downTo 0 step 8) {
          out.write((value shr shift).toInt() and 0xFF)
        }
      }
    }
    return out.toByteArray()
  }
}
