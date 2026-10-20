import {
  isPasskeyItem,
  mergePendingPasskey,
  parsePendingPasskeys,
  passkeyRecordsFromItems,
  passkeySyncPayload,
  type PendingPasskey,
} from "../passkeys";
import type { VaultItem } from "../types";

const P256 = "A".repeat(43);

function pending(partial: Partial<PendingPasskey> = {}): PendingPasskey {
  return {
    vaultItemId: "passkey-item-1",
    credentialId: "credential-1",
    rpId: "example.com",
    userHandle: "dXNlci0x",
    userName: "me@example.com",
    displayName: "Example account",
    privateKey: P256,
    publicKeyX: P256,
    publicKeyY: P256,
    createdAt: 100,
    lastUsedAt: 0,
    signCount: 0,
    pending: true,
    ...partial,
  };
}

function item(partial: Partial<VaultItem> = {}): VaultItem {
  return {
    id: "passkey-item-1",
    type: "login",
    name: "Example",
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

describe("Android passkey import", () => {
  it("validates the native queue and ignores unusable records", () => {
    const parsed = parsePendingPasskeys(
      JSON.stringify({
        version: 1,
        credentials: [
          pending(),
          pending({ credentialId: "credential-2", vaultItemId: "bad id" }),
          pending({ credentialId: "credential-3", privateKey: "short" }),
          pending({ credentialId: "credential-4", rpId: "not a host" }),
          pending({ credentialId: "credential-5", publicKeyX: "short" }),
        ],
      })
    );

    expect(parsed.map((entry) => entry.credentialId)).toEqual(["credential-1"]);
  });

  it("deduplicates retries by credential ID, keeping the latest row", () => {
    const parsed = parsePendingPasskeys(
      JSON.stringify({
        version: 1,
        credentials: [
          pending({ displayName: "Old", createdAt: 1 }),
          pending({ displayName: "New", createdAt: 2 }),
        ],
      })
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0].displayName).toBe("New");
  });

  it("creates a login item without inventing a password", () => {
    const created = mergePendingPasskey(undefined, pending(), 200);

    expect(created).toMatchObject({
      id: "passkey-item-1",
      type: "login",
      name: "Example account",
      username: "me@example.com",
      urls: ["https://example.com"],
      createdAt: 100,
      updatedAt: 200,
    });
    expect(created.password).toBeUndefined();
    expect(created.passkey?.credentialId).toBe("credential-1");
    expect(isPasskeyItem(created)).toBe(true);
  });

  it("preserves notes, folders, and an existing password", () => {
    const merged = mergePendingPasskey(
      item({
        name: "My custom name",
        username: "old@example.com",
        password: "still-here",
        notes: "recovery codes",
        folder: "Work",
        favorite: true,
        deletedAt: 5,
        urls: ["https://login.example.com"],
      }),
      pending(),
      300
    );

    expect(merged).toMatchObject({
      id: "passkey-item-1",
      name: "My custom name",
      username: "old@example.com",
      password: "still-here",
      notes: "recovery codes",
      folder: "Work",
      favorite: true,
      updatedAt: 300,
    });
    expect(merged.deletedAt).toBeUndefined();
    expect(merged.urls).toEqual([
      "https://login.example.com",
      "https://example.com",
    ]);
  });

  it("mirrors live passkeys and forwards tombstones for native deletion", () => {
    const live = item({
      id: "live-item-1",
      name: "GitHub",
      username: "octocat",
      passkey: {
        credentialId: "credential-1",
        rpId: "github.com",
        userHandle: "dXNlci0x",
        userName: "octocat",
        displayName: "GitHub",
        privateKey: P256,
        publicKeyX: P256,
        publicKeyY: P256,
        createdAt: 1,
      },
    });
    const deleted = item({
      id: "deleted-item-1",
      deletedAt: 10,
      passkey: live.passkey,
    });

    expect(passkeyRecordsFromItems([live, deleted])).toHaveLength(1);
    const payload = passkeySyncPayload([live, deleted]);
    expect(payload.credentials.map((entry) => entry.vaultItemId)).toEqual([
      "live-item-1",
    ]);
    expect(payload.deletedVaultItemIds).toEqual(["deleted-item-1"]);
  });
});
