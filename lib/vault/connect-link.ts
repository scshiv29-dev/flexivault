import { normalizeServerUrl } from "./api";

/**
 * What a "connect" QR code or deep link pre-fills on the sign-in screens.
 * It never carries the master password: that is the only thing able to
 * decrypt the vault, so it is always typed on the device itself.
 */
export interface ConnectLink {
  server: string;
  email?: string;
  invite?: string;
}

export function buildConnectLink({ server, email, invite }: ConnectLink): string {
  const params = new URLSearchParams();
  params.set("server", normalizeServerUrl(server));
  if (email?.trim()) params.set("email", email.trim().toLowerCase());
  if (invite?.trim()) params.set("invite", invite.trim());
  return `flexivault://connect?${params.toString()}`;
}

function clean(value: string | null | undefined, max: number): string | undefined {
  const trimmed = String(value ?? "").trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

/**
 * Parses a scanned code. Accepts `flexivault://connect?server=…` links (from
 * the server's /connect page or another phone) and plain http(s) server
 * addresses. Returns null for anything else, e.g. an otpauth:// code.
 */
export function parseConnectLink(raw: string): ConnectLink | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  if (/^flexivault:\/\//i.test(text)) {
    const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : "";
    const host = text.replace(/^flexivault:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
    if (host !== "connect") return null;
    const params = new URLSearchParams(query);
    const server = clean(params.get("server"), 2048);
    if (!server || !/^https?:\/\//i.test(server)) return null;
    try {
      return {
        server: normalizeServerUrl(server),
        email: clean(params.get("email"), 320)?.toLowerCase(),
        invite: clean(params.get("invite"), 128),
      };
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      // A link to the server's own connect page should still point at the server.
      const path = url.pathname.replace(/\/(connect)?\/?$/, "");
      return { server: normalizeServerUrl(`${url.protocol}//${url.host}${path}`) };
    } catch {
      return null;
    }
  }
  return null;
}
