import type { VaultItem } from "./types";

export interface VaultGroup {
  name: string;
  count: number;
  items: VaultItem[];
}

/**
 * Groups are represented by the encrypted `folder` field on each item. There is
 * deliberately no separate plaintext group table: an empty group would leak its
 * name outside the vault, and groups should sync to every device with the items
 * that belong to them.
 */
export function listGroups(items: VaultItem[]): VaultGroup[] {
  const groups = new Map<string, VaultItem[]>();

  for (const item of items) {
    if (item.deletedAt) continue;
    const name = item.folder?.trim();
    if (!name) continue;
    const existing = groups.get(name);
    if (existing) existing.push(item);
    else groups.set(name, [item]);
  }

  return Array.from(groups, ([name, groupItems]) => ({
    name,
    count: groupItems.length,
    items: groupItems,
  })).sort(
    (left, right) =>
      right.count - left.count ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
}

export function groupNames(items: VaultItem[]): string[] {
  return listGroups(items).map((group) => group.name);
}

export function normaliseGroupName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
