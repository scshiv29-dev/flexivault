package com.shivamchaudhary.flexiauth.autofill

import android.app.assist.AssistStructure
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import java.util.ArrayDeque

data class AutofillFields(
  val usernameId: AutofillId?,
  val passwordId: AutofillId?,
  val webDomain: String?,
  val packageName: String?,
)

object AutofillParser {
  private const val MAX_NODES = 2500
  private val USERNAME_TEXT = Regex("user|email|login|account", RegexOption.IGNORE_CASE)
  private val PASSWORD_TEXT = Regex("pass(word|wd|code)?|pwd", RegexOption.IGNORE_CASE)

  fun parse(structure: AssistStructure): AutofillFields? {
    var usernameId: AutofillId? = null
    var firstUsernameId: AutofillId? = null
    var lastUsernameId: AutofillId? = null
    var passwordId: AutofillId? = null
    var webDomain: String? = null
    var visited = 0

    for (windowIndex in 0 until structure.windowNodeCount) {
      val queue = ArrayDeque<AssistStructure.ViewNode>()
      queue.add(structure.getWindowNodeAt(windowIndex).rootViewNode)
      while (queue.isNotEmpty() && visited < MAX_NODES) {
        val node = queue.removeFirst()
        visited += 1

        if (webDomain == null) {
          val domain = node.webDomain
          if (!domain.isNullOrBlank()) {
            webDomain = normaliseDomain(domain)
          }
        }

        val id = node.autofillId
        if (id != null && node.visibility == View.VISIBLE && node.isEnabled && !isButton(node)) {
          if (isPasswordField(node)) {
            if (passwordId == null) {
              passwordId = id
              // The username is normally the last username-like field before
              // the password. Never overwrite it with a later field (some
              // pages place a submit button after the password).
              usernameId = lastUsernameId ?: firstUsernameId
            }
          } else if (isUsernameField(node)) {
            if (firstUsernameId == null) firstUsernameId = id
            lastUsernameId = id
            if (passwordId == null && usernameId == null) usernameId = id
          }
        }

        for (childIndex in 0 until node.childCount) {
          queue.add(node.getChildAt(childIndex))
        }
      }
    }

    if (passwordId == null && usernameId == null && firstUsernameId == null) {
      return null
    }
    return AutofillFields(
      usernameId = usernameId ?: firstUsernameId,
      passwordId = passwordId,
      webDomain = webDomain,
      packageName = structure.activityComponent?.packageName,
    )
  }

  private fun isButton(node: AssistStructure.ViewNode): Boolean {
    val className = node.className?.toString().orEmpty()
    return className.contains("Button", ignoreCase = true) ||
      className.contains("ImageButton", ignoreCase = true)
  }

  private fun isPasswordField(node: AssistStructure.ViewNode): Boolean {
    val hints = node.autofillHints.orEmpty()
    if (hints.any { it == View.AUTOFILL_HINT_PASSWORD }) {
      return true
    }

    val variation = node.inputType and InputType.TYPE_MASK_VARIATION
    if (
      variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
      variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
    ) {
      return true
    }

    return PASSWORD_TEXT.containsMatchIn(fieldText(node))
  }

  private fun isUsernameField(node: AssistStructure.ViewNode): Boolean {
    val hints = node.autofillHints.orEmpty()
    if (
      hints.any {
        it == View.AUTOFILL_HINT_USERNAME || it == View.AUTOFILL_HINT_EMAIL_ADDRESS
      }
    ) {
      return true
    }
    return USERNAME_TEXT.containsMatchIn(fieldText(node))
  }

  private fun fieldText(node: AssistStructure.ViewNode): String {
    // Chrome exposes virtual web nodes with an HTML tag and attributes. Those
    // names are often the only hint that a field is a login field.
    val html = node.htmlInfo?.let { info ->
      listOfNotNull(
        info.tag,
        info.attributes?.joinToString(" ") { attribute ->
          "${attribute.first}=${attribute.second}"
        },
      ).joinToString(" ")
    }
    return listOfNotNull(
      node.idEntry,
      node.hint,
      node.contentDescription?.toString(),
      html,
    ).joinToString(" ")
  }

  private fun normaliseDomain(value: String): String? {
    val domain = value.trim().lowercase()
      .removePrefix("https://")
      .removePrefix("http://")
      .substringBefore('/')
      .substringBefore(':')
      .trimEnd('.')
      .removePrefix("www.")
    return domain.ifEmpty { null }
  }
}
