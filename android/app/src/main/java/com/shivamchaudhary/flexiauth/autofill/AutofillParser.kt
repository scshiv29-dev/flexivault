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
  /** Text already in the username field (what the user started typing), used
   * to narrow the suggestions. Null when the field is empty. */
  val typedUsername: String? = null,
)

data class AutofillSaveData(
  val username: String?,
  val password: String,
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
    var firstDomain: String? = null
    val domains = HashMap<AutofillId, String?>()
    val nodes = HashMap<AutofillId, AssistStructure.ViewNode>()
    var focusedUsernameId: AutofillId? = null
    var visited = 0

    for (windowIndex in 0 until structure.windowNodeCount) {
      val queue = ArrayDeque<Pair<AssistStructure.ViewNode, String?>>()
      queue.add(structure.getWindowNodeAt(windowIndex).rootViewNode to null)
      while (queue.isNotEmpty() && visited < MAX_NODES) {
        val (node, inheritedDomain) = queue.removeFirst()
        visited += 1

        // A page can embed frames from other sites (ads, captchas, sign-in
        // widgets). Track the domain of the frame that owns each field rather
        // than taking the first domain seen anywhere in the tree.
        val ownDomain = node.webDomain?.takeIf { it.isNotBlank() }?.let(::normaliseDomain)
        val domain = ownDomain ?: inheritedDomain
        if (firstDomain == null && ownDomain != null) firstDomain = ownDomain

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
            domains[id] = domain
          } else if (isUsernameField(node)) {
            if (firstUsernameId == null) firstUsernameId = id
            lastUsernameId = id
            if (passwordId == null && usernameId == null) usernameId = id
            if (node.isFocused) focusedUsernameId = id
            domains[id] = domain
            nodes[id] = node
          }
        }

        for (childIndex in 0 until node.childCount) {
          queue.add(node.getChildAt(childIndex) to domain)
        }
      }
    }

    if (passwordId == null && usernameId == null && firstUsernameId == null) {
      return null
    }
    val resolvedUsernameId = usernameId ?: firstUsernameId
    val fieldDomain = passwordId?.let { domains[it] }
      ?: resolvedUsernameId?.let { domains[it] }
    // Prefer the focused username field's text; otherwise the username that
    // belongs to this password (typed before moving to the password field).
    val typedNode = (focusedUsernameId ?: resolvedUsernameId)?.let { nodes[it] }
    return AutofillFields(
      usernameId = resolvedUsernameId,
      passwordId = passwordId,
      webDomain = fieldDomain ?: firstDomain,
      packageName = structure.activityComponent?.packageName,
      typedUsername = typedNode?.let(::typedText),
    )
  }

  private fun typedText(node: AssistStructure.ViewNode): String? {
    val value = nodeValue(node, allowTextFallback = true)?.trim() ?: return null
    if (value.isEmpty() || value.length > 500) return null
    // Some views report their placeholder as text when empty.
    if (value == node.hint?.trim()) return null
    return value
  }

  /**
   * Extracts the submitted credential values from a save request. Save requests
   * contain the current view hierarchy, not the dataset we filled, so the values
   * must be read back from the password and username nodes.
   *
   * A form with more than one populated password field is usually a
   * change-password or sign-up form. Saving the first field would store the old
   * (or new) password under the wrong identity, so those requests are ignored.
   */
  fun parseSave(structure: AssistStructure): AutofillSaveData? {
    val fields = parse(structure) ?: return null
    val passwordId = fields.passwordId ?: return null
    var usernameNode: AssistStructure.ViewNode? = null
    var passwordNode: AssistStructure.ViewNode? = null
    var populatedPasswordFields = 0
    var visited = 0

    for (windowIndex in 0 until structure.windowNodeCount) {
      val queue = ArrayDeque<AssistStructure.ViewNode>()
      queue.add(structure.getWindowNodeAt(windowIndex).rootViewNode)
      while (queue.isNotEmpty() && visited < MAX_NODES) {
        val node = queue.removeFirst()
        visited += 1

        val id = node.autofillId
        if (id != null) {
          if (id == passwordId) passwordNode = node
          if (id == fields.usernameId) usernameNode = node
        }
        if (
          node.visibility == View.VISIBLE &&
          node.isEnabled &&
          isPasswordField(node) &&
          nodeValue(node, allowTextFallback = false) != null
        ) {
          populatedPasswordFields += 1
        }

        for (childIndex in 0 until node.childCount) {
          queue.add(node.getChildAt(childIndex))
        }
      }
    }

    if (populatedPasswordFields > 1) return null
    val password = passwordNode?.let { nodeValue(it, allowTextFallback = false) }
      ?: passwordNode?.let { nodeValue(it, allowTextFallback = true) }
      ?: return null
    if (password.isEmpty() || password.length > 4096) return null

    val username = usernameNode
      ?.let { nodeValue(it, allowTextFallback = true) }
      ?.trim()
      ?.take(500)
      ?.ifEmpty { null }

    return AutofillSaveData(
      username = username,
      password = password,
      webDomain = fields.webDomain,
      packageName = fields.packageName,
    )
  }

  private fun nodeValue(
    node: AssistStructure.ViewNode,
    allowTextFallback: Boolean,
  ): String? {
    val value = node.autofillValue
    if (value != null && value.isText) {
      val text = value.textValue?.toString()
      if (!text.isNullOrEmpty()) return text
    }
    if (!allowTextFallback) return null
    val text = node.text?.toString()?.takeIf { it.isNotEmpty() } ?: return null
    // A masked password field can expose bullets through getText(). Never save
    // those as the password.
    return text.takeUnless { candidate ->
      candidate.all { it == '\u2022' || it == '\u25CF' || it == '*' }
    }
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

    val variation = node.inputType and InputType.TYPE_MASK_VARIATION
    if (
      variation == InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ||
      variation == InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
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
