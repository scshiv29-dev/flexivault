package com.shivamchaudhary.flexiauth.autofill

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.shivamchaudhary.flexiauth.R

/**
 * Confirmation surface shown after a login form is submitted. It is a separate
 * translucent task (empty affinity) so it draws over the calling app instead of
 * bringing FlexiVault's main task forward. Credentials arrive through
 * [AutofillSaveHandoff], never through the Intent.
 */
class AutofillSaveActivity : FragmentActivity() {
  companion object {
    const val EXTRA_TOKEN = "save_token"
  }

  private var draft: AutofillPendingSave? = null
  private var finished = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
    window.setDimAmount(0.45f)
    setFinishOnTouchOutside(false)

    if (savedInstanceState != null) {
      finish()
      return
    }

    val token = intent?.getStringExtra(EXTRA_TOKEN)
    val pending = AutofillSaveHandoff.take(token)
    if (pending == null) {
      finish()
      return
    }
    draft = pending
    setContentView(buildContent(pending))
  }

  private fun buildContent(save: AutofillPendingSave): FrameLayout {
    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.TRANSPARENT)
      setPadding(dp(22), dp(22), dp(22), dp(22))
    }

    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(22), dp(20), dp(22), dp(16))
      background = GradientDrawable().apply {
        setColor(color(R.color.autofill_card))
        cornerRadius = dp(22).toFloat()
        setStroke(dp(1), color(R.color.autofill_field))
      }
      elevation = dp(18).toFloat()
    }
    root.addView(
      card,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.CENTER,
      ),
    )

    val title = TextView(this).apply {
      text = if (save.mode == "update") "Update login?" else "Save login?"
      setTextColor(color(R.color.autofill_text))
      textSize = 20f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    card.addView(title)

    val target = save.hosts.firstOrNull()
      ?: save.packages.firstOrNull()
      ?: save.name
    val subtitle = TextView(this).apply {
      text = if (save.mode == "update") {
        "Change the saved password for $target"
      } else {
        "Add this login for $target to FlexiVault"
      }
      setTextColor(color(R.color.autofill_muted))
      textSize = 13f
      setPadding(0, dp(4), 0, dp(16))
    }
    card.addView(subtitle)

    val nameInput = field("Name", save.name)
    card.addView(label("Name"))
    card.addView(nameInput)

    val usernameInput = field("Username", save.username.orEmpty())
    card.addView(label("Username"))
    card.addView(usernameInput)

    val passwordInput = field("Password", save.password).apply {
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
      setSelection(text.length)
    }
    card.addView(label("Password"))
    card.addView(passwordInput)

    val note = TextView(this).apply {
      text = "FlexiVault encrypts this now and syncs it the next time you unlock the app."
      setTextColor(color(R.color.autofill_muted))
      textSize = 11.5f
      setPadding(0, dp(10), 0, dp(14))
    }
    card.addView(note)

    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
    }
    card.addView(actions)

    val cancel = Button(this).apply {
      text = "Not now"
      isAllCaps = false
      setTextColor(color(R.color.autofill_muted))
      backgroundTintList = ColorStateList.valueOf(Color.TRANSPARENT)
      setOnClickListener { finishWithCancel() }
    }
    actions.addView(
      cancel,
      LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
    )

    val saveButton = Button(this).apply {
      text = if (save.mode == "update") "Update" else "Save"
      isAllCaps = false
      setTextColor(color(R.color.activityBackground))
      backgroundTintList = ColorStateList.valueOf(color(R.color.autofill_accent))
      setOnClickListener {
        val name = nameInput.text?.toString()?.trim()?.take(200)
        if (name.isNullOrEmpty()) {
          nameInput.error = "Enter a name"
          return@setOnClickListener
        }
        val password = passwordInput.text?.toString()?.take(4096).orEmpty()
        if (password.isEmpty()) {
          passwordInput.error = "Enter the password"
          return@setOnClickListener
        }
        val updated = save.copy(
          name = name,
          username = usernameInput.text?.toString()?.trim()?.take(500)?.ifEmpty { null },
          password = password,
        )
        if (AutofillPendingStore.add(this@AutofillSaveActivity, updated)) {
          Toast.makeText(
            this@AutofillSaveActivity,
            "Saved to FlexiVault",
            Toast.LENGTH_SHORT,
          ).show()
          finishWithCancel()
        } else {
          Toast.makeText(
            this@AutofillSaveActivity,
            "Could not save this login",
            Toast.LENGTH_SHORT,
          ).show()
        }
      }
    }
    actions.addView(
      saveButton,
      LinearLayout.LayoutParams(dp(112), ViewGroup.LayoutParams.WRAP_CONTENT).apply {
        marginStart = dp(8)
      },
    )

    return root
  }

  private fun label(text: String): TextView = TextView(this).apply {
    this.text = text
    setTextColor(color(R.color.autofill_muted))
    textSize = 11f
    setPadding(0, dp(7), 0, dp(4))
  }

  private fun field(hint: String, value: String): EditText = EditText(this).apply {
    this.hint = hint
    setText(value)
    setTextColor(color(R.color.autofill_text))
    setHintTextColor(color(R.color.autofill_muted))
    textSize = 15f
    setSingleLine(true)
    setPadding(dp(12), dp(9), dp(12), dp(9))
    background = GradientDrawable().apply {
      setColor(color(R.color.autofill_field))
      cornerRadius = dp(10).toFloat()
    }
  }

  private fun color(id: Int): Int = ContextCompat.getColor(this, id)

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private fun finishWithCancel() {
    if (finished) return
    finished = true
    setResult(RESULT_CANCELED)
    finish()
  }

  @Deprecated("Deprecated in the Android SDK.")
  override fun onBackPressed() {
    finishWithCancel()
  }
}
