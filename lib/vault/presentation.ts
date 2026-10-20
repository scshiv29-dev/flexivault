import { VaultItem } from "./types";

const searchTextCache = new WeakMap<VaultItem, string>();

export function itemIcon(item: VaultItem): string {
  switch (item.type) {
    case "card":
      return "credit-card";
    case "note":
      return "file-text";
    case "identity":
      return "user";
    case "totp":
      return "hash";
    default:
      return item.totp?.secret ? "shield" : "key";
  }
}

export function itemTypeLabel(item: VaultItem): string {
  if (item.passkey) {
    return item.totp?.secret ? "Passkey + 2FA" : "Passkey";
  }
  switch (item.type) {
    case "card":
      return "Card";
    case "note":
      return "Secure note";
    case "identity":
      return "Identity";
    case "totp":
      return "Authenticator";
    default:
      return item.totp?.secret ? "Login + 2FA" : "Login";
  }
}

export function lastFour(value?: string): string {
  const clean = String(value ?? "").replace(/\s+/g, "");
  return clean.length > 4 ? `•••• ${clean.slice(-4)}` : clean;
}

export function itemSubtitle(item: VaultItem): string {
  switch (item.type) {
    case "card":
      return [item.card?.brand, lastFour(item.card?.number)].filter(Boolean).join(" · ") || "Payment card";
    case "note":
      return item.notes?.trim().split("\n")[0]?.slice(0, 70) || "Secure note";
    case "identity":
      return item.identity?.fullName || item.identity?.email || "Identity";
    case "totp": {
      const issuer = item.totp?.issuer;
      const label = item.totp?.label || item.username;
      return [issuer, label].filter(Boolean).join(" · ") || "Authenticator";
    }
    default: {
      if (item.passkey && !item.username) return item.passkey.rpId;
      if (item.username) return item.username;
      const host = item.urls?.find((url) => url.trim().length > 0);
      if (host) return host.replace(/^https?:\/\//, "").replace(/\/$/, "");
      return item.totp?.secret ? "Login with 2FA" : "Login";
    }
  }
}

function searchableText(item: VaultItem): string {
  const cached = searchTextCache.get(item);
  if (cached !== undefined) return cached;

  const text = [
    item.name,
    item.username,
    item.notes,
    item.folder,
    item.totp?.issuer,
    item.totp?.label,
    item.card?.brand,
    item.card?.holder,
    item.identity?.fullName,
    item.identity?.email,
    item.passkey?.rpId,
    item.passkey?.userName,
    item.passkey?.displayName,
    ...(item.urls ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  searchTextCache.set(item, text);
  return text;
}

function matchesNeedle(item: VaultItem, needle: string): boolean {
  return !needle || searchableText(item).includes(needle);
}

export function itemMatchesQuery(item: VaultItem, query: string): boolean {
  return matchesNeedle(item, query.trim().toLowerCase());
}

export function groupItemsAlphabetically(
  items: VaultItem[]
): Array<{ letter: string; items: VaultItem[] }> {
  const sorted = items.slice().sort((left, right) => {
    if (Boolean(left.favorite) !== Boolean(right.favorite)) {
      return left.favorite ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  const groups = new Map<string, VaultItem[]>();
  for (const item of sorted) {
    const first = item.name.trim().charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : "#";
    const existing = groups.get(letter);
    if (existing) existing.push(item);
    else groups.set(letter, [item]);
  }
  return Array.from(groups, ([letter, groupItems]) => ({
    letter,
    items: groupItems,
  }));
}

export function filterItems(
  items: VaultItem[],
  category: string,
  query: string
): VaultItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (item.deletedAt) return false;
    if (!matchesNeedle(item, needle)) return false;

    switch (category) {
      case "favorites":
        return Boolean(item.favorite);
      case "logins":
        return item.type === "login";
      case "codes":
        return Boolean(item.totp?.secret);
      case "cards":
        return item.type === "card";
      case "notes":
        return item.type === "note" || item.type === "identity";
      default:
        return true;
    }
  });
}
