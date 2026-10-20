import type { VaultItem } from "./types";

export interface AutofillPayloadLogin {
  id: string;
  name: string;
  username?: string;
  password: string;
  hosts: string[];
  packages: string[];
}

export interface AutofillPayload {
  version: 1;
  logins: AutofillPayloadLogin[];
}

const PACKAGE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/;
export const MAX_ANDROID_PACKAGES = 20;

export function isAndroidPackageName(value: string): boolean {
  return PACKAGE_PATTERN.test(value.trim());
}

/**
 * Android's autofill service matches the package name of the app that owns the
 * focused form. A website URL cannot tell us that package name, so users add it
 * explicitly for native apps. Keep validation here so the same rules apply in
 * the editor and the native cache writer.
 */
export function parseAndroidPackages(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of value.split(/[\s,;]+/)) {
    const name = part.trim();
    if (!name || !PACKAGE_PATTERN.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
    if (result.length >= MAX_ANDROID_PACKAGES) break;
  }

  return result;
}

export function hostFromUrl(value: string): string | null {
  const raw = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  if (!raw) return null;

  const authority = raw.split(/[/?#]/, 1)[0] ?? "";
  if (!authority) return null;

  let hostPart: string;
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    if (end < 0) return null;
    hostPart = authority.slice(1, end);
  } else {
    hostPart = authority.split("@").pop() ?? "";
    hostPart = hostPart.split(":", 1)[0] ?? "";
  }

  const host = hostPart
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  if (!host || /\s/.test(host)) return null;
  return host;
}

/**
 * The native cache is deliberately login-only. Notes, cards, identities, TOTP
 * seeds and the vault key never leave the encrypted vault.
 */
export function buildAutofillPayload(items: VaultItem[]): AutofillPayload {
  const logins: AutofillPayloadLogin[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (item.deletedAt || item.type !== "login") continue;
    const password = item.password ?? "";
    if (!password) continue;
    if (!item.name.trim()) continue;
    if (seen.has(item.id)) continue;

    const hosts = Array.from(
      new Set(
        (item.urls ?? [])
          .map((url) => hostFromUrl(url))
          .filter(
            (host): host is string =>
              host !== null && (host === "localhost" || host.includes("."))
          )
      )
    ).slice(0, 20);
    const packages = Array.from(
      new Set((item.androidPackages ?? []).filter((name) => PACKAGE_PATTERN.test(name)))
    ).slice(0, MAX_ANDROID_PACKAGES);

    // Keep logins without a website or package too. Android can match them to
    // a native app by the app label or package tokens (for example a "Reddit"
    // login and the Reddit app). Browser matching still requires a host.
    seen.add(item.id);
    logins.push({
      id: item.id,
      name: item.name,
      username: item.username?.trim() || undefined,
      password,
      hosts,
      packages,
    });
    if (logins.length >= 5000) break;
  }

  return { version: 1, logins };
}
