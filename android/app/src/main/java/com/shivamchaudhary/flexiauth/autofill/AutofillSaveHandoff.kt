package com.shivamchaudhary.flexiauth.autofill

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * In-process handoff from the autofill service to the save confirmation
 * activity. Credentials are never put in the Intent extras, so they cannot leak
 * through intent logging or a parcel dump. The token is single-use.
 */
object AutofillSaveHandoff {
  private const val MAX_DRAFTS = 8
  private val drafts = ConcurrentHashMap<String, AutofillPendingSave>()

  @Synchronized
  fun put(save: AutofillPendingSave): String {
    while (drafts.size >= MAX_DRAFTS) {
      val oldest = drafts.keys.firstOrNull() ?: break
      drafts.remove(oldest)
    }
    val token = UUID.randomUUID().toString()
    drafts[token] = save
    return token
  }

  fun take(token: String?): AutofillPendingSave? {
    if (token.isNullOrBlank()) return null
    return drafts.remove(token)
  }

  fun discard(token: String?) {
    if (!token.isNullOrBlank()) drafts.remove(token)
  }
}
