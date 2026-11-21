// Who may create an account on this server.
//
// Order of checks for a registration attempt:
//   1. Emails listed in ADMIN_EMAILS can always register (bootstraps the admin).
//   2. A valid invite link: only the invite's own email/domain limits apply,
//      so an admin can invite someone outside the server-wide filters.
//   3. A static INVITE_CODES code, open registration, or a request from the
//      local network (when allowed): the server-wide email filters apply.

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function splitList(value) {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(/[\s,;]+/);
  return [...new Set(parts.map((v) => String(v).trim().toLowerCase()).filter(Boolean))];
}

export function normaliseDomain(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\.$/, "");
}

/**
 * True when `email` matches the allow-lists. Empty lists allow everyone.
 * Domain entries match the exact domain; "*.example.com" also matches
 * subdomains such as mail.example.com.
 */
export function emailAllowed(email, { allowedDomains = [], allowedEmails = [] } = {}) {
  if (allowedDomains.length === 0 && allowedEmails.length === 0) return true;
  const address = String(email ?? "").trim().toLowerCase();
  if (allowedEmails.includes(address)) return true;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return allowedDomains.some((raw) => {
    const entry = normaliseDomain(raw);
    if (entry.startsWith("*.")) {
      const base = entry.slice(2);
      return domain === base || domain.endsWith(`.${base}`);
    }
    return domain === entry;
  });
}

/** Loopback, private (RFC 1918), link-local and unique-local addresses. */
export function isLocalAddress(ip) {
  let value = String(ip ?? "").trim().toLowerCase();
  if (value.startsWith("::ffff:")) value = value.slice(7);
  const v4 = value.match(IPV4_RE);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (value === "::1") return true;
  return /^f[cd][0-9a-f]{2}:/.test(value) || /^fe[89ab][0-9a-f]:/.test(value);
}

export function defaultRules(config) {
  return {
    registrationOpen: Boolean(config.registrationOpen),
    allowedDomains: splitList(config.signupDomains).map(normaliseDomain),
    allowedEmails: splitList(config.signupEmails),
    allowLocal: Boolean(config.signupAllowLocal),
  };
}

/** Validates admin input into a stored rules object. */
export function sanitiseRules(input, current) {
  const next = { ...current };
  if (input.registrationOpen !== undefined) next.registrationOpen = Boolean(input.registrationOpen);
  if (input.allowLocal !== undefined) next.allowLocal = Boolean(input.allowLocal);
  if (input.allowedDomains !== undefined) {
    next.allowedDomains = splitList(input.allowedDomains).map(normaliseDomain).slice(0, 200);
    for (const domain of next.allowedDomains) {
      if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
        return { error: `"${domain}" is not a valid domain` };
      }
    }
  }
  if (input.allowedEmails !== undefined) {
    next.allowedEmails = splitList(input.allowedEmails).slice(0, 500);
    for (const email of next.allowedEmails) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { error: `"${email}" is not a valid email` };
      }
    }
  }
  return { rules: next };
}

/** Domain/email limits carried by one invite link. */
export function inviteAllows(invite, email) {
  const address = String(email).toLowerCase();
  if (invite.email && invite.email !== address) return false;
  const domains = splitList(invite.domains);
  if (domains.length > 0 && !emailAllowed(address, { allowedDomains: domains })) return false;
  return true;
}

/**
 * Decides whether `email` may register. Returns { ok: true, via } or
 * { ok: false, status, code, message }.
 */
export function decideRegistration({ email, rules, adminEmails, invite, staticCodeOk, ip }) {
  if (adminEmails.includes(email)) return { ok: true, via: "admin" };

  if (invite) {
    if (!inviteAllows(invite, email)) {
      return {
        ok: false,
        status: 403,
        code: "email_not_allowed",
        message: invite.email
          ? `This invite is for ${invite.email}`
          : "This invite is not valid for that email address",
      };
    }
    return { ok: true, via: "invite" };
  }

  const viaRule = staticCodeOk
    ? "code"
    : rules.registrationOpen
      ? "open"
      : rules.allowLocal && isLocalAddress(ip)
        ? "local"
        : null;

  if (!viaRule) return null;
  if (!emailAllowed(email, rules)) {
    return {
      ok: false,
      status: 403,
      code: "email_not_allowed",
      message: "This server does not accept sign-ups for that email address",
    };
  }
  return { ok: true, via: viaRule };
}
