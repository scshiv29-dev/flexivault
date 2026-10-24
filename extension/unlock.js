/* Password entry belongs to this extension origin, never to the parent page. */
const token = location.hash.slice(1);
const password = document.getElementById("master-password");
const unlock = document.getElementById("unlock");
const status = document.getElementById("status");
let busy = false;
let cancelled = false;

async function send(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, token, ...extra });
  if (!result?.ok) throw new Error(result?.error || "Could not unlock. Try again.");
  return result;
}

try {
  const info = await send("flexivault:unlock-info");
  document.getElementById("target").textContent = `Continue filling on ${info.host}`;
  password.disabled = false;
  unlock.disabled = false;
  password.focus();
} catch (error) {
  status.textContent = error.message;
}

document.getElementById("unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!event.isTrusted || busy || cancelled || password.disabled) return;
  busy = true;
  unlock.disabled = true;
  password.disabled = true;
  unlock.textContent = "Unlocking…";
  status.textContent = "";
  try {
    await send("flexivault:unlock-submit", { password: password.value });
    password.value = "";
    status.textContent = "Unlocked. Choose a saved login on the form.";
    window.close();
  } catch (error) {
    password.value = "";
    if (cancelled) return;
    status.textContent = error.message;
    password.disabled = false;
    unlock.disabled = false;
    unlock.textContent = "Unlock";
    password.focus();
  } finally {
    busy = false;
  }
});

async function cancel() {
  cancelled = true;
  password.value = "";
  password.disabled = true;
  unlock.disabled = true;
  await send("flexivault:unlock-cancel").catch((error) => { status.textContent = error.message; });
  window.close();
}
document.getElementById("cancel").addEventListener("click", (event) => {
  if (event.isTrusted) void cancel();
});
document.addEventListener("keydown", (event) => {
  if (event.isTrusted && event.key === "Escape") {
    event.preventDefault();
    void cancel();
  }
});
