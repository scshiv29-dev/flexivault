import { passwordStrength } from "./generator";
import { VaultItem } from "./types";

export interface ReusedGroup {
  password: string;
  itemIds: string[];
}

export interface SecurityReport {
  score: number;
  label: string;
  totalLogins: number;
  weak: VaultItem[];
  reused: ReusedGroup[];
  missing2fa: VaultItem[];
  stale: VaultItem[];
  suggestions: string[];
}

export function itemDisplayUrl(item: VaultItem): string | null {
  const first = item.urls?.find((value) => value.trim().length > 0);
  if (!first) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(first) ? first : `https://${first}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return first;
  }
}

export function hostnameMatches(hostname: string, urls?: string[]): boolean {
  if (!urls || urls.length === 0) return false;
  const normalizedHost = hostname.replace(/^www\./, "").toLowerCase();
  return urls.some((value) => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    try {
      const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      const candidate = url.hostname.replace(/^www\./, "").toLowerCase();
      return (
        candidate === normalizedHost ||
        normalizedHost.endsWith(`.${candidate}`) ||
        candidate.endsWith(`.${normalizedHost}`)
      );
    } catch {
      return false;
    }
  });
}

export function analyzeSecurity(items: VaultItem[]): SecurityReport {
  const active = items.filter((item) => !item.deletedAt);
  const logins = active.filter(
    (item) => item.type === "login" && Boolean(item.password)
  );

  const weak = logins.filter(
    (item) => passwordStrength(item.password ?? "").score <= 1
  );

  const byPassword = new Map<string, string[]>();
  for (const item of logins) {
    const password = item.password ?? "";
    if (password.length < 4) continue;
    const list = byPassword.get(password) ?? [];
    list.push(item.id);
    byPassword.set(password, list);
  }
  const reused: ReusedGroup[] = Array.from(byPassword.entries())
    .filter(([, ids]) => ids.length > 1)
    .map(([password, itemIds]) => ({ password, itemIds }));

  const missing2fa = logins.filter((item) => !item.totp?.secret);
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const stale = logins.filter((item) => item.updatedAt < oneYearAgo);

  let score = 100;
  if (logins.length > 0) {
    score -= Math.min(40, Math.round((weak.length / logins.length) * 40));
    score -=
      reused.length > 0
        ? Math.min(25, 10 + reused.length * 5)
        : 0;
    score -= Math.min(20, Math.round((missing2fa.length / logins.length) * 20));
    score -= Math.min(10, Math.round((stale.length / logins.length) * 10));
  }
  score = Math.max(0, Math.min(100, score));

  const label =
    score >= 85
      ? "Locked down"
      : score >= 65
        ? "Looking good"
        : score >= 40
          ? "Needs attention"
          : "At risk";

  const suggestions: string[] = [];
  if (weak.length > 0) {
    suggestions.push(
      `Replace ${weak.length} weak ${weak.length === 1 ? "password" : "passwords"} with generated ones.`
    );
  }
  if (reused.length > 0) {
    suggestions.push(
      `${reused.length} ${reused.length === 1 ? "password is" : "passwords are"} reused across accounts.`
    );
  }
  if (missing2fa.length > 0) {
    suggestions.push(
      `Add two-factor authentication to ${missing2fa.length} ${missing2fa.length === 1 ? "login" : "logins"}.`
    );
  }
  if (stale.length > 0) {
    suggestions.push(`Rotate ${stale.length} older ${stale.length === 1 ? "password" : "passwords"}.`);
  }
  if (suggestions.length === 0) {
    suggestions.push("Your vault looks healthy. Keep using unique passwords and 2FA.");
  }

  return {
    score,
    label,
    totalLogins: logins.length,
    weak,
    reused,
    missing2fa,
    stale,
    suggestions,
  };
}
