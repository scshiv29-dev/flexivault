package com.shivamchaudhary.flexiauth.crypto

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Pure PBKDF2-HMAC-SHA256. Kept separate from the React Native module so the
 * vector used by the vault can be unit-tested on the JVM.
 */
internal object Pbkdf2 {
  fun derive(
    password: ByteArray,
    salt: ByteArray,
    iterations: Int,
    length: Int,
  ): ByteArray {
    require(iterations > 0) { "The iteration count must be positive." }
    require(length > 0) { "The output length must be positive." }

    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(password, "HmacSHA256"))
    val hashLength = mac.macLength
    val blockCount = (length + hashLength - 1) / hashLength
    val output = ByteArray(length)
    val block = ByteArray(salt.size + 4)
    System.arraycopy(salt, 0, block, 0, salt.size)

    var offset = 0
    for (blockIndex in 1..blockCount) {
      block[salt.size] = (blockIndex ushr 24).toByte()
      block[salt.size + 1] = (blockIndex ushr 16).toByte()
      block[salt.size + 2] = (blockIndex ushr 8).toByte()
      block[salt.size + 3] = blockIndex.toByte()

      var u = mac.doFinal(block)
      val mixed = u.copyOf()
      for (round in 2..iterations) {
        u = mac.doFinal(u)
        for (index in mixed.indices) {
          mixed[index] = (mixed[index].toInt() xor u[index].toInt()).toByte()
        }
      }

      val take = minOf(hashLength, length - offset)
      System.arraycopy(mixed, 0, output, offset, take)
      offset += take
    }
    return output
  }
}
