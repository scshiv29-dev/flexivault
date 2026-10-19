/* Presentation helpers shared by popup views. */

const PALETTES = [
  ["#DDF6EC", "#0B8563"],
  ["#E5E9FC", "#3E4DB3"],
  ["#FCEBDD", "#A85A19"],
  ["#FBE2EA", "#B0325B"],
  ["#E1EFFC", "#2668A7"],
  ["#F1E6FD", "#6F3FB5"],
  ["#FBF4D4", "#8A6C0C"],
  ["#E3F4F8", "#1F7486"],
];

export function paletteFor(seed) {
  let hash = 0;
  const value = String(seed ?? "");
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 9973;
  }
  return PALETTES[Math.abs(hash) % PALETTES.length];
}

export function initialOf(name) {
  const clean = String(name ?? "").trim();
  return (clean[0] || "•").toUpperCase();
}

export function itemSubtitle(item) {
  switch (item.type) {
    case "card": {
      const last = lastFour(item.card?.number);
      return [item.card?.brand, last].filter(Boolean).join(" · ") || "Payment card";
    }
    case "note":
      return item.notes?.trim().split("\n")[0]?.slice(0, 64) || "Secure note";
    case "identity":
      return item.identity?.fullName || item.identity?.email || "Identity";
    case "totp": {
      const issuer = item.totp?.issuer;
      const label = item.totp?.label || item.username;
      return [issuer, label].filter(Boolean).join(" · ") || "Authenticator";
    }
    default:
      if (item.username) return item.username;
      const host = hostOf(item.urls?.[0]);
      if (host) return host;
      return item.totp?.secret ? "Login with 2FA" : "Login";
  }
}

export function typeLabel(item) {
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

export function lastFour(value) {
  const clean = String(value ?? "").replace(/\s+/g, "");
  return clean.length > 4 ? `•••• ${clean.slice(-4)}` : clean;
}

export function hostOf(value) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return String(value)
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");
  }
}

export function matchesQuery(item, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
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
    ...(item.urls ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function relativeTime(timestamp) {
  if (!timestamp) return "never";
  const delta = Date.now() - Number(timestamp);
  if (delta < 45_000) return "just now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(Number(timestamp)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function withScheme(value) {
  if (!value) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
}

/** Hostname without `www.` or port, or "" when the value is not a URL. */
export function siteHost(value) {
  if (!value) return "";
  try {
    return new URL(withScheme(String(value))).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Treat subdomains as the same site, but never unrelated suffixes. */
export function sameSite(left, right) {
  const first = siteHost(left);
  const second = siteHost(right);
  if (!first || !second) return false;
  if (first === second) return true;
  return first.endsWith(`.${second}`) || second.endsWith(`.${first}`);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
