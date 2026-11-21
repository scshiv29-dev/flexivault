import { qrSvg } from "./qr.js";

/**
 * Builds the link the mobile app understands. The app opens it from the
 * system camera (custom scheme) or from its own QR scanner and pre-fills the
 * server address, and optionally the email and an invite code.
 *
 * The master password is never part of the link: it is the only thing that
 * can decrypt the vault, so it must be typed on the device itself.
 */
export function buildConnectLink({ server, email, invite } = {}) {
  const params = new URLSearchParams();
  params.set("server", server);
  if (email) params.set("email", email);
  if (invite) params.set("invite", invite);
  return `flexivault://connect?${params.toString()}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

export function renderConnectPage({
  serverName,
  serverUrl,
  email = "",
  invite = "",
  registrationOpen,
  inviteRequired,
}) {
  const link = buildConnectLink({ server: serverUrl, email, invite });
  const svg = qrSvg(link, { size: 280, label: "Scan to connect FlexiVault" });
  const name = escapeHtml(serverName);
  const signup = registrationOpen
    ? "New accounts are open on this server."
    : inviteRequired
      ? "New accounts need an invite code from the server owner."
      : "New accounts are closed on this server.";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Connect to ${name}</title>
<style>
:root { --bg:#f6f5f1; --card:#fff; --ink:#1b1b1a; --muted:#6b6a66; --line:#e3e1da; --accent:#2f6f4f; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#111211; --card:#1b1c1b; --ink:#ecebe6; --muted:#a3a29c; --line:#2c2d2b; --accent:#7cc39c; }
}
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:480px; margin:0 auto; padding:32px 16px 48px; }
h1 { font-size:28px; line-height:1.2; margin:0 0 6px; }
p { margin:0 0 12px; color:var(--muted); }
.card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; margin-top:20px; }
.qr { display:flex; justify-content:center; }
.qr svg { width:100%; max-width:280px; height:auto; border-radius:8px; }
code { display:block; word-break:break-all; font-size:13px; background:var(--bg); border:1px solid var(--line); border-radius:8px; padding:8px 10px; color:var(--ink); }
ol { margin:0; padding-left:20px; color:var(--muted); }
li { margin-bottom:6px; }
label { display:block; font-size:13px; font-weight:600; margin:12px 0 4px; }
input { width:100%; font:inherit; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--ink); }
button { margin-top:14px; width:100%; font:inherit; font-weight:600; padding:11px; border:0; border-radius:10px; background:var(--accent); color:#fff; cursor:pointer; }
@media (prefers-color-scheme: dark) { button { color:#0d1a13; } }
.small { font-size:13px; }
</style>
</head>
<body>
<main>
  <h1>Connect to ${name}</h1>
  <p>Scan this code with the FlexiVault app instead of typing the server address.</p>

  <div class="card">
    <div class="qr">${svg}</div>
    <p class="small" style="margin-top:14px">Server address</p>
    <code>${escapeHtml(serverUrl)}</code>
    ${email ? `<p class="small" style="margin-top:10px">Account</p><code>${escapeHtml(email)}</code>` : ""}
  </div>

  <div class="card">
    <ol>
      <li>On the phone, open FlexiVault and tap <strong>Sign in to a server</strong> (or <strong>Settings → Server</strong> if you already have a vault).</li>
      <li>Tap <strong>Scan QR code</strong> and point the camera here. On Android you can also scan with the camera app.</li>
      <li>Type your master password on the phone. It is never put in the code: only you can unlock your vault.</li>
    </ol>
    <p class="small" style="margin-top:10px">${escapeHtml(signup)}</p>
  </div>

  <form class="card" method="get" action="">
    <p style="margin:0">Pre-fill more details (optional)</p>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="off" value="${escapeHtml(email)}" placeholder="you@example.com">
    ${inviteRequired || invite ? `<label for="invite">Invite code</label>
    <input id="invite" name="invite" autocomplete="off" value="${escapeHtml(invite)}" placeholder="From the server owner">` : ""}
    <button type="submit">Update QR code</button>
  </form>
</main>
</body>
</html>`;
}

/** Shown at /connect when sign-up is closed and no valid invite was given. */
export function renderPrivatePage({ serverName }) {
  const name = escapeHtml(serverName);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${name}</title>
<style>
:root { --bg:#f6f5f1; --card:#fff; --ink:#1b1b1a; --muted:#6b6a66; --line:#e3e1da; --accent:#2f6f4f; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#111211; --card:#1b1c1b; --ink:#ecebe6; --muted:#a3a29c; --line:#2c2d2b; --accent:#7cc39c; }
}
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:480px; margin:0 auto; padding:48px 16px; }
h1 { font-size:26px; line-height:1.2; margin:0 0 8px; }
p { color:var(--muted); margin:0 0 12px; }
a { color:var(--accent); font-weight:600; }
.card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding:20px; margin-top:20px; }
</style>
</head>
<body>
<main>
  <h1>${name} is private</h1>
  <p>New accounts on this server are by invitation only. Ask the server admin for an invite link.</p>
  <div class="card">
    <p>Already have an account? <a href="/app/">Sign in to the web vault</a>. Its <strong>Connect a phone</strong> button shows a QR code for your phone.</p>
  </div>
</main>
</body>
</html>`;
}
