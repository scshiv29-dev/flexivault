# FlexiVault server

A self-hostable, zero-dependency sync server for FlexiVault. It stores an
account row and a list of opaque, client-encrypted vault items. It never
receives the master password or the vault key.

- Node.js **22.5+** (`node:sqlite`, `node:http`, `node:crypto`)
- No npm dependencies
- SQLite database in a single data directory
- HS256 bearer tokens, scrypt auth verifiers, optional server-side TOTP

## Run locally

```bash
cd server
npm start
# FlexiVault server listening on http://localhost:8787
```

Data is written to `server/data/flexivault.sqlite` by default. Set `DATA_DIR` to
put it elsewhere.

```bash
PORT=9000 DATA_DIR=/var/lib/flexivault npm start
```

On first start the server also generates `jwt.key` and `encryption.key` in the
data directory if `JWT_SECRET` / `ENCRYPTION_SECRET` are not set. Back these up
with the database: `jwt.key` signs sessions, and `encryption.key` protects the
stored TOTP secrets.

## Docker

From the repository root:

```bash
cp .env.example .env
docker compose up -d --build
```

The compose file builds `server/Dockerfile`, publishes `${FLEXIVAULT_PORT}`
(default `8787`), and keeps the database in the `flexivault-data` volume.
Put the service behind a TLS reverse proxy before exposing it to the internet.

For Coolify, use [`../docker-compose.coolify.yml`](../docker-compose.coolify.yml)
and the step-by-step guide in [`../docs/COOLIFY.md`](../docs/COOLIFY.md).

### Caddy example

```caddy
vault.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

### nginx example

```nginx
server {
  listen 443 ssl http2;
  server_name vault.example.com;

  client_max_body_size 10m;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `TRUST_PROXY=true` only when a proxy overwrites `X-Forwarded-For`; otherwise
clients can spoof the rate-limit key.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `8787` | Listen port |
| `DATA_DIR` | `server/data` | Database and generated key material |
| `SERVER_NAME` | `FlexiVault` | Name returned by `/api/health` and `/api/server-info` |
| `REGISTRATION_OPEN` | `true` | Default for open sign-up (the admin page can change it) |
| `ADMIN_EMAILS` | empty | Comma-separated accounts that get the web **Admin** page; they can always register |
| `SIGNUP_DOMAINS` | empty | Default allowed email domains, e.g. `example.com,*.corp.org` (empty = any) |
| `SIGNUP_EMAILS` | empty | Default allowed email addresses, even outside `SIGNUP_DOMAINS` |
| `SIGNUP_ALLOW_LOCAL` | `false` | Default for letting localhost / private-network clients sign up without an invite |
| `INVITE_CODES` | empty | Comma-separated static codes that still allow sign-up when sign-up is closed |
| `PUBLIC_URL` | derived | Public address used in QR codes and invite links, e.g. `https://vault.example.com` |
| `CONNECT_PAGE` | `true` | Serve the QR connect page at `/connect` |
| `REGISTER_RATE_LIMIT` | `10` | Sign-ups per hour per IP |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins; `*` allows any |
| `JWT_SECRET` | generated | 32+ byte token-signing secret |
| `ENCRYPTION_SECRET` | generated | 32+ byte key for server-side TOTP secrets |
| `TOKEN_TTL_SECONDS` | `2592000` (30 days) | Bearer token lifetime |
| `MAX_VAULT_BYTES` | `8388608` (8 MiB) | Maximum JSON request body |
| `MAX_ITEMS` | `5000` | Maximum items per vault |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for rate limiting |
| `QUIET` | `false` | Disable request logging |

The sign-up settings (`REGISTRATION_OPEN`, `SIGNUP_*`) are only defaults.
Once an admin saves **Who can sign up** on the web Admin page, the saved rules
win until changed there again.

## Web vault

The server hosts a browser vault at `https://<your server>/app/` (`/`
redirects there). Users sign in with the same email and master password as
the app and can search, view, add, edit and delete items, copy passwords and
live 2FA codes, and filter by:

- **Type**: logins, 2FA codes, notes, cards, identities
- **Domain**: grouped by site (`login.github.com` and `github.com` →
  `github.com`)
- **Email / username**: every account name used in the vault
- **Localhost & LAN**: `localhost`, private IPs (`192.168.x`, `10.x`, …) and
  names such as `router.lan` or `nas.local`
- **Favorites**, plus free-text search

Decryption happens in the browser with the same format as the app and
extension (PBKDF2-SHA256 → AES-256-GCM envelopes), and edits sync with the
same revision and merge rules, so changes appear on phones on their next sync.
The vault locks after 15 minutes without activity or on reload.

**Connect a phone** in the web vault shows a QR code with the server and the
user's email for the app to scan.

The web vault's code is served by your server, as with any web password
manager. Someone who controls the server could change it, so only use it
on a server you trust, over HTTPS.

## Connect phones with a QR code

Signed-in users get their QR code from **Connect a phone** in the web vault,
and new users get one right after creating their account from an invite link.

`https://<your server>/connect` also shows a QR code with the server address,
but only while sign-up is open, to visitors from the local network when that is
allowed, or with a valid invite (`/connect?invite=…`). Otherwise it shows a
"this server is private" page. In the app,
tap **Scan QR code** on the *Sign in to a server* screen or in
**Settings → Server**; on Android the system camera can open the code too.

A signed-in phone can show the same kind of code for another phone:
**Settings → Server → Show QR code**.

The code is a `flexivault://connect?server=…&email=…&invite=…` link. It never
contains the master password: that password is the only thing that can decrypt
the vault, so it is typed on each device once. After that, turn on biometric
unlock so you do not have to type it again.

Behind a reverse proxy, set `PUBLIC_URL` (or `TRUST_PROXY=true` with a proxy
that sets `X-Forwarded-Proto` / `X-Forwarded-Host`) so the QR code points at
the public `https://` address rather than the container's internal one.

## Multiple users and invites

One server holds any number of accounts. Each person has their own email,
master password and vault; nobody, including admins, can read anyone else's
items.

### Set up the admin

1. Set `ADMIN_EMAILS=you@example.com` and restart. Sign-up can stay closed:
   admin emails can always register.
2. Open `https://<your server>/app/`, choose **Create an account**, and sign up
   with that email. (Or sign in if the account already exists from the app.)
3. **Admin** appears in the top bar.

### Invite someone

On the Admin page, **Invite someone** creates a private link such as
`https://vault.example.com/app/#/join/fvi_…`. Optionally lock it to one email
(single use) or to email domains, and set the number of uses and the expiry
(1–90 days). The link is shown once; copy it or let the person scan its QR code
with their phone camera. Revoke unused links from the **Invite links** table.

The person opens the link, picks a master password, and their account is
created. They then see a QR code for the app (**Sign in to a server → Scan QR
code**) or can type the server address, email and password by hand, and can
use the web vault straight away.

Invite links work even when sign-up is closed and ignore the server-wide email
filters, but always apply their own email/domain lock. Only a SHA-256 of each
link is stored.

### Who can sign up

**Who can sign up** on the Admin page controls everyone without an invite link:

- **Open sign-up** on or off
- **Allowed email domains** (`example.com`, `*.corp.org` for subdomains) and
  **allowed email addresses**; empty means any
- **Allow sign-up from localhost and the home network**: requests from
  `127.0.0.1`, `10.x`, `172.16–31.x`, `192.168.x` and IPv6 local addresses can
  sign up without an invite. Behind a reverse proxy this needs
  `TRUST_PROXY=true`, otherwise every request looks local.

Static `INVITE_CODES` still work (typed into the app's invite field or the
web sign-up page) and are subject to the email filters.

### Manage accounts

The Admin page lists accounts (item count, 2FA, dates) and can delete one.
From a shell on the server (in Docker, prefix with `docker compose exec server`):

```bash
npm run users -- list                       # email, item count, 2FA, dates
npm run users -- delete someone@example.com # removes the account and its vault
npm run users -- reset-2fa someone@example.com
```

There is no password reset: the server cannot decrypt anyone's vault.

## Data model

SQLite tables:

- `users` — email, scrypt-hashed `authHash`, KDF salt/iterations, revision,
  optional encrypted TOTP secret
- `vault_items` — `(user_id, item_id)` plus an opaque `data` envelope
- `invites` — admin invite links: SHA-256 of the token, optional email/domain
  lock, uses, expiry, revocation
- `server_meta` — server settings, including the admin's saved sign-up rules
- `unlock_shares` — extension TOTP quick unlock: a random share (encrypted with
  the server key), SHA-256 of a device secret, last accepted TOTP step, failure
  count and a 30-day expiry. The share alone cannot decrypt anything; the
  wrapped vault key it unlocks stays in the browser.

The server never stores item names, usernames, passwords, notes, or TOTP
secrets in plaintext. `authHash` is derived client-side from the master
password and sent over TLS; the server scrypt-hashes it again before storage.

## API

All routes are JSON under `/api` unless noted. Errors are
`{ "error": string, "code": string }`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/app/` | — | Web vault (static files; `/` redirects here) |
| `GET` | `/connect` | — | QR page for the app; private unless sign-up is open, the visitor is local (when allowed) or `?invite=` is valid |
| `GET` | `/api/invites/:token` | — | Invite link details: `{ serverName, email, domains, expiresAt }` or `404 invite_invalid` |
| `GET` | `/api/health` | — | Liveness and server name |
| `GET` | `/api/server-info` | — | Registration status, `inviteRequired`, limits, server time |
| `POST` | `/api/accounts/register` | — | `{ email, authHash, kdfSalt, kdfIterations, inviteCode? }` → token + profile; `inviteCode` is an invite link token or a static code |
| `POST` | `/api/accounts/prelogin` | — | `{ email }` → KDF salt/iterations and `totpEnabled` |
| `POST` | `/api/accounts/login` | — | `{ email, authHash, totpCode? }` → token + profile |
| `GET` | `/api/accounts/me` | Bearer | Current profile |
| `POST` | `/api/2fa/setup` | Bearer | Create a pending TOTP secret and `otpauth://` URL |
| `POST` | `/api/2fa/enable` | Bearer | `{ code }` → `{ totpEnabled: true }` |
| `POST` | `/api/2fa/disable` | Bearer | `{ code }` → `{ totpEnabled: false }` |
| `POST` | `/api/quick-unlock` | Bearer | `{ replaceId? }` → `{ id, share, deviceSecret, expiresAt }`; needs 2FA on |
| `POST` | `/api/quick-unlock/release` | — | `{ id, deviceSecret, code }` → `{ share, token, ...profile }` |
| `POST` | `/api/quick-unlock/revoke` | — | `{ id, deviceSecret }` → `{ revoked: true }` |
| `GET` | `/api/sync` | Bearer | `{ revision, items: [{ id, data, updatedAt }] }` |
| `PUT` | `/api/sync` | Bearer | `{ baseRevision, items, force? }` → new revision |
| `GET` | `/api/admin/overview` | Admin | `{ rules, users, invites }` (no item contents) |
| `PUT` | `/api/admin/rules` | Admin | `{ registrationOpen?, allowLocal?, allowedDomains?, allowedEmails? }` |
| `POST` | `/api/admin/invites` | Admin | `{ email?, domains?, maxUses?, expiresInDays?, note? }` → `{ invite, token, url }` |
| `DELETE` | `/api/admin/invites/:id` | Admin | Revoke an invite link |
| `DELETE` | `/api/admin/users/:email` | Admin | Delete another account and its vault |

Profiles (`register`, `login`, `me`) include `isAdmin`. Sign-up errors:
`invite_required`, `invalid_invite`, `email_not_allowed`, `registration_closed`.

`PUT /api/sync` replaces the whole item set. A stale `baseRevision` returns
`409 revision_mismatch` with the current revision and items so the client can
merge and retry. `force: true` skips the check and is used only for an explicit
"overwrite server" action.

Item IDs must match `^[A-Za-z0-9_-]{8,64}$`. Each `data` value must be a
`v1.<iv>.<ciphertext+tag>` envelope, at most 300,000 characters. Anything else
is rejected with `invalid_item`, so the server cannot be used as plaintext
storage by mistake.

Rate limits are in-memory and per process: registration `10/hour/IP`,
prelogin `60/15min/IP`, login `30/15min/IP` plus `15/15min/email`, sync
`240/15min/user`, quick-unlock release `30/15min/IP` plus `10/15min/share`.
A release code must be newer than the last accepted one (no replay), and five
wrong codes in a row delete the share. They reset on restart and are not shared between replicas.

## Backup and restore

Stop the container (or use `sqlite3 .backup`) and copy the whole data
directory / volume:

```bash
docker compose stop
docker run --rm -v flexivault_flexivault-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/flexivault-backup.tgz -C /data .
docker compose start
```

Restore by extracting the archive into an empty volume. Keep the generated
`jwt.key` and `encryption.key` with the database.

## Security notes

- TLS is required in production. The `authHash` is a password-equivalent
  verifier for the account, even though it cannot decrypt the vault.
- The server is zero-knowledge with respect to vault item contents. It does
  learn account email, KDF parameters, item IDs, sizes, and revision counts.
- There is no password reset. Losing the master password means losing the
  vault; the server has no copy of the key.
- No email verification, password change, or account deletion endpoint is
  implemented. Delete an account with `npm run users -- delete <email>`.
- Rotating `ENCRYPTION_SECRET` invalidates stored TOTP secrets. Disable 2FA
  first or re-enroll afterwards.
- This is a single-node server. Do not run multiple replicas against one
  SQLite file.

## Tests

```bash
npm test
```

The suite starts the app on an ephemeral port with a temporary data directory
and covers registration, login, sync conflicts, envelope validation, and TOTP
setup/enable/disable.
