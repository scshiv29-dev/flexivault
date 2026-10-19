import { groupNames, listGroups, normaliseGroupName } from "../groups";
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

describe("vault groups", () => {
  it("derives groups from encrypted folder fields and ignores tombstones", () => {
    const items = [
      item({ id: "1", name: "GitHub", folder: "Work" }),
      item({ id: "2", name: "GitLab", folder: "Work" }),
      item({ id: "3", name: "Bank", folder: " Personal " }),
      item({ id: "4", name: "Deleted", folder: "Work", deletedAt: 10 }),
      item({ id: "5", name: "No group" }),
    ];

    const groups = listGroups(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ name: "Work", count: 2 });
    expect(groups[1]).toMatchObject({ name: "Personal", count: 1 });
    expect(groupNames(items)).toEqual(["Work", "Personal"]);
  });

  it("sorts by count, then name", () => {
    const groups = listGroups([
      item({ id: "1", name: "A", folder: "Zeta" }),
      item({ id: "2", name: "B", folder: "Alpha" }),
      item({ id: "3", name: "C", folder: "Alpha" }),
    ]);
    expect(groups.map((group) => group.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("normalises whitespace in group names", () => {
    expect(normaliseGroupName("  Work   accounts  ")).toBe("Work accounts");
  });
});
