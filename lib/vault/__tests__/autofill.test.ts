import {
  buildAutofillPayload,
  hostFromUrl,
  isAndroidPackageName,
  parseAndroidPackages,
} from "../autofill";
import type { VaultItem } from "../types";

function item(partial: Partial<VaultItem>): VaultItem {
  return {
    id: partial.id ?? "item-1",
    type: "login",
    name: partial.name ?? "Example",
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...partial,
  };
}

describe("system autofill payload", () => {
  it("normalises web hosts", () => {
    expect(hostFromUrl("https://www.Example.com/login?x=1")).toBe("example.com");
    expect(hostFromUrl("example.com:8443/path")).toBe("example.com");
    expect(hostFromUrl("https://user:pass@example.com:8443/x")).toBe("example.com");
    expect(hostFromUrl("  ")).toBeNull();
  });

  it("validates and deduplicates Android package names", () => {
    expect(
      parseAndroidPackages("com.example.app, com.example.app; bad com.example.two")
    ).toEqual(["com.example.app", "com.example.two"]);
    expect(parseAndroidPackages("not-a-package")).toEqual([]);
    expect(isAndroidPackageName("com.example.app")).toBe(true);
    expect(isAndroidPackageName("com.example")).toBe(true);
    expect(isAndroidPackageName("com")).toBe(false);
    expect(isAndroidPackageName("com..app")).toBe(false);
  });

  it("includes only logins with a password and a host or package", () => {
    const payload = buildAutofillPayload([
      item({ id: "1", password: "one", urls: ["https://www.github.com/login"] }),
      item({ id: "2", password: "secret", androidPackages: ["com.github.android"] }),
      item({ id: "3", password: "", urls: ["https://empty.example"] }),
      item({ id: "4", password: "no-target" }),
      item({ id: "5", type: "note", password: "not-a-login", urls: ["https://note.example"] }),
      item({ id: "6", password: "deleted", urls: ["https://old.example"], deletedAt: 1 }),
      item({ id: "7", password: "single-label", urls: ["https://intranet"] }),
    ]);

    expect(payload.logins.map((login) => login.id)).toEqual(["1", "2"]);
    expect(payload.logins[0]).toMatchObject({
      hosts: ["github.com"],
      packages: [],
    });
    expect(payload.logins[1]).toMatchObject({
      hosts: [],
      packages: ["com.github.android"],
    });
  });

  it("does not include TOTP or notes in any field", () => {
    const payload = buildAutofillPayload([
      item({
        id: "1",
        password: "secret",
        username: "me",
        notes: "recovery codes",
        urls: ["https://example.com"],
        totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 },
      }),
    ]);

    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain("JBSWY3DPEHPK3PXP");
    expect(serialised).not.toContain("recovery codes");
  });
});
