// Account management for the server owner. Run it where the data directory
// lives (inside the container: `docker compose exec server npm run users -- list`).
//
//   npm run users -- list
//   npm run users -- delete someone@example.com
//   npm run users -- reset-2fa someone@example.com
//
// The server never holds a usable copy of anyone's vault key, so there is no
// password reset: deleting an account permanently removes its encrypted vault.
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";

const [command, rawEmail] = process.argv.slice(2);
const email = String(rawEmail ?? "").trim().toLowerCase();
const db = openDatabase(loadConfig().dataDir);

function findUser() {
  if (!email) {
    console.error(`Usage: npm run users -- ${command} <email>`);
    process.exit(1);
  }
  const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
  if (!user) {
    console.error(`No account for ${email}`);
    process.exit(1);
  }
  return user;
}

switch (command) {
  case "list": {
    const rows = db
      .prepare(
        `SELECT u.email, u.totp_enabled AS totp, u.created_at AS created, u.updated_at AS updated,
                (SELECT COUNT(*) FROM vault_items v WHERE v.user_id = u.id) AS items
         FROM users u ORDER BY u.created_at`
      )
      .all();
    if (rows.length === 0) {
      console.log("No accounts yet.");
      break;
    }
    console.table(
      rows.map((row) => ({
        email: row.email,
        items: row.items,
        "2fa": row.totp ? "on" : "off",
        created: new Date(row.created).toISOString().slice(0, 10),
        "last change": new Date(row.updated).toISOString().slice(0, 16).replace("T", " "),
      }))
    );
    break;
  }
  case "delete": {
    const user = findUser();
    // vault_items and unlock_shares cascade.
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
    console.log(`Deleted ${user.email} and its encrypted vault.`);
    break;
  }
  case "reset-2fa": {
    const user = findUser();
    db.prepare(
      `UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, updated_at = ?
       WHERE id = ?`
    ).run(Date.now(), user.id);
    db.prepare("DELETE FROM unlock_shares WHERE user_id = ?").run(user.id);
    console.log(`Turned off server two-factor for ${user.email}.`);
    break;
  }
  default:
    console.log("Usage: npm run users -- <list | delete <email> | reset-2fa <email>>");
    process.exitCode = command ? 1 : 0;
}

db.close();
