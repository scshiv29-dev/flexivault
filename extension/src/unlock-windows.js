/* Finds open unlock.html windows so the extension never shows two at once. */

/** Returns [{ windowId, mode }] for every open unlock.html page. Form unlocks
 * opened for a website have mode "form". */
export async function openUnlockWindows() {
  if (typeof chrome.runtime?.getContexts !== "function") return [];
  const base = chrome.runtime.getURL("unlock.html");
  let contexts = [];
  try {
    contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
  } catch {
    return [];
  }
  const seen = new Set();
  const found = [];
  for (const context of contexts ?? []) {
    const url = String(context?.documentUrl ?? "");
    if (!url.startsWith(base) || !Number.isInteger(context.windowId)) continue;
    if (seen.has(context.windowId)) continue;
    seen.add(context.windowId);
    let mode = "form";
    try {
      mode = new URL(url).searchParams.get("mode") ?? "form";
    } catch {
      // Keep the default.
    }
    found.push({ windowId: context.windowId, mode });
  }
  return found;
}
