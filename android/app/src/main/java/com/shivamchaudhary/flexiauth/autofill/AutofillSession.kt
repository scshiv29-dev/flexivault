package com.shivamchaudhary.flexiauth.autofill

import android.os.SystemClock

/** No persistent unlocked bit: a process restart always starts locked. */
internal object AutofillSession {
  private var unlockedUntil = 0L
  private var generation = 0L

  @Synchronized fun epoch(): Long = generation
  @Synchronized fun isUnlocked(): Boolean = SystemClock.elapsedRealtime() < unlockedUntil
  @Synchronized fun lock() {
    generation += 1
    unlockedUntil = 0L
  }
  @Synchronized fun configure(epoch: Long, minutes: Int, write: () -> Unit) {
    if (epoch != generation) return
    write()
    unlockedUntil = if (minutes <= 0) Long.MAX_VALUE else
      SystemClock.elapsedRealtime() + minutes.toLong() * 60_000L
  }
}
