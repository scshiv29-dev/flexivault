import { filterItems, itemMatchesQuery } from "../presentation";
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

describe("vault item search", () => {
  it("matches name, username, URL and notes case-insensitively", () => {
    const acme = item({
      id: "acme",
      name: "Acme Portal",
      username: "ada@example.com",
      urls: ["https://login.acme.test"],
      notes: "Production console",
    });

    expect(itemMatchesQuery(acme, "acme")).toBe(true);
    expect(itemMatchesQuery(acme, "ADA@")).toBe(true);
    expect(itemMatchesQuery(acme, "production")).toBe(true);
    expect(itemMatchesQuery(acme, "unrelated")).toBe(false);
    expect(itemMatchesQuery(acme, "   ")).toBe(true);
  });

  it("filters tombstones and category buckets without changing query matching", () => {
    const items = [
      item({ id: "login", name: "Acme", favorite: true, urls: ["https://acme.test"] }),
      item({ id: "code", name: "Acme 2FA", totp: { secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA1", digits: 6, period: 30 } }),
      item({ id: "card", type: "card", name: "Acme Card" }),
      item({ id: "deleted", name: "Acme Deleted", deletedAt: 10 }),
    ];

    expect(filterItems(items, "all", "acme").map((entry) => entry.id)).toEqual([
      "login",
      "code",
      "card",
    ]);
    expect(filterItems(items, "favorites", "").map((entry) => entry.id)).toEqual([
      "login",
    ]);
    expect(filterItems(items, "codes", "").map((entry) => entry.id)).toEqual([
      "code",
    ]);
    expect(filterItems(items, "cards", "").map((entry) => entry.id)).toEqual([
      "card",
    ]);
  });
});
