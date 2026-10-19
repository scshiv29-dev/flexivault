# Importing passwords

FlexiVault imports CSV and JSON exports from other password managers. Parsing
happens entirely on the device; the import file is never sent to the sync
server.

## Supported files

| Source | Format | Notes |
| --- | --- | --- |
| Bitwarden | CSV or JSON | JSON keeps folder names, cards, identities and TOTP secrets. |
| 1Password | CSV | 1Password 8 desktop export. `.1pux` archives are not supported. |
| Chrome / Edge / Brave | CSV | Passwords export from the browser's password settings. |
| LastPass | CSV | `url,username,password,extra,name,grouping,fav`. |
| Dashlane | CSV | Generic CSV mapping. |
| Proton Pass | CSV | Use a CSV export, not an encrypted Proton JSON backup. |
| KeePassXC | CSV | Includes groups and TOTP when those columns are exported. |
| Generic | CSV or JSON | Header aliases are detected; see below. |

Password-protected, encrypted, or zipped exports are rejected because the app
cannot decrypt another manager's format. Export plain CSV/JSON, import it, then
delete the export.

## How to import

1. In the other password manager, export an unencrypted **CSV** or **JSON**
   file.
2. In FlexiVault, open **Settings → Import passwords**.
3. Choose **Choose file**, or paste the text.
4. Check the preview: item count, detected format, skipped rows, invalid TOTP
   warnings, and the first few items.
5. Optionally set a **group override**. If set, every imported item goes into
   that group; if empty, the folder/group names from the file are preserved.
6. Tap **Import N items**. The items are encrypted and saved locally, then sync
   like any other vault item.

The import is a copy. FlexiVault does not connect to the other manager and does
not keep the source file.

## Field mapping

Headers are normalized to lowercase with punctuation collapsed to underscores.
Common aliases are recognized:

| FlexiVault field | Header aliases |
| --- | --- |
| Name | `name`, `title`, `item_name` |
| Username | `username`, `user`, `login`, `login_username`, `email` |
| Password | `password`, `pass`, `login_password` |
| URL | `url`, `uri`, `login_uri`, `login_url`, `website` |
| Notes | `notes`, `note`, `comments`, `extra` |
| Group | `folder`, `group`, `grouping`, `collection`, `category`, `vault`, `tags` |
| Favorite | `favorite`, `fav`, `starred` |
| Type | `type`, `item_type`, `kind` |
| TOTP | `totp`, `otp`, `login_totp`, `otpsecret` |
| Card number | `card_number`, `cardnumber`, `number` |
| Card holder | `card_holder`, `cardholder`, `cardholdername` |
| Expiry | `expiry`, `expiration`, `expirydate` |
| CVV | `cvv`, `cvc`, `security_code` |
| Card brand | `brand`, `card_brand` |

CSV delimiters (comma, semicolon, tab) are detected, including the Excel
`sep=;` preamble. Quoted fields, embedded commas, escaped quotes and multiline
notes are handled.

Bitwarden JSON is detected by the top-level `items` and `folders` arrays. A
generic JSON array of objects is also accepted, including credentials nested
under a `login` object.

## What is imported

- Logins: name, username, password, URLs, notes, group, favorite.
- Secure notes: name, notes, group, favorite.
- Cards: number, holder, expiry, CVV, brand.
- Identities: name, email, phone, address, company, passport.
- TOTP: `otpauth://` URLs and valid base32 secrets become live authenticator
  configs. An invalid secret keeps the login but drops the TOTP and shows a
  warning.

Duplicate detection is not automatic. If you import the same file twice, you
will get two copies. Search for the item name and delete the extras, or merge
the files before importing.

## Groups

Groups are stored in each item's encrypted `folder` field. A group therefore
appears as soon as one imported item belongs to it, syncs to other devices with
the items, and disappears when its last item is deleted. **Settings → Groups**
can rename a group, delete it without deleting items, and add new items to it.
Renaming a group re-encrypts and syncs every affected item.

## Limits and safety

- A single import is limited to 5,000 items, matching the server's vault limit.
  Split larger exports.
- The whole vault must be unlocked. Imports are re-encrypted with the vault key.
- The sync server receives only ciphertext, exactly as for manually created
  items.
- The export file contains plaintext secrets. Delete it after import, and do not
  leave it in Downloads or a synced cloud folder.
- An import is not a backup. Use the encrypted backup in **Settings → Copy
  encrypted backup** separately.

## Troubleshooting

| Problem | Likely cause |
| --- | --- |
| "No rows to import" | The file has only a header, or the delimiter was not detected. Try re-exporting as standard comma-separated CSV. |
| Everything is skipped | The app could not identify a title/name or credential column. Check the header row; use the aliases above. |
| Notes lost | Multiline fields must be quoted in the CSV. A correct exporter does this automatically. |
| TOTP warning | The secret is not valid base32, or the column is encrypted. Re-export it, or add the authenticator manually. |
| Import is slow | Re-encrypting thousands of items is CPU-heavy on a phone. Keep the app in the foreground until it finishes. |
| Sync fails after import | The server's `MAX_ITEMS` limit (default 5,000) may be exceeded, or the request is larger than `MAX_VAULT_BYTES`. |
