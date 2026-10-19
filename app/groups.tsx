import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, Divider } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { IconTile } from "@/components/ui/IconTile";
import { PageHeader } from "@/components/ui/PageHeader";
import { Screen } from "@/components/ui/Screen";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { ItemRow } from "@/components/vault/ItemRow";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { listGroups, normaliseGroupName } from "@/lib/vault/groups";

export default function GroupsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const { items, renameGroup, deleteGroup } = useVault();

  const groups = useMemo(() => listGroups(items), [items]);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const selected = useMemo(
    () => groups.find((group) => group.name === selectedName) ?? null,
    [groups, selectedName]
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCreate = () => {
    setNewName("");
    setError(null);
    setCreateOpen(true);
  };

  const createGroup = () => {
    const name = normaliseGroupName(newName);
    if (!name) {
      setError("Give the group a name.");
      return;
    }
    if (name.length > 80) {
      setError("Group names are limited to 80 characters.");
      return;
    }
    setCreateOpen(false);
    router.push({ pathname: "/new", params: { group: name } });
  };

  const openRename = () => {
    if (!selected) return;
    setRenameName(selected.name);
    setError(null);
    setRenameOpen(true);
  };

  const submitRename = async () => {
    if (!selected) return;
    const name = normaliseGroupName(renameName);
    if (!name) {
      setError("Give the group a name.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await renameGroup(selected.name, name);
      setSelectedName(name);
      setRenameOpen(false);
      toast.show("Group renamed", "success");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await deleteGroup(selected.name);
      setDeleteOpen(false);
      setSelectedName(null);
      toast.show("Group removed; items were kept", "success");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (selectedName) {
      setSelectedName(null);
      return;
    }
    router.back();
  };

  return (
    <Screen bottomPadding={48}>
      <PageHeader
        eyebrow={selected ? "Group" : "Organize"}
        title={selected ? selected.name : "Groups"}
        subtitle={
          selected
            ? `${selected.count} ${selected.count === 1 ? "item" : "items"} in this group.`
            : "Group related logins, notes and cards. Groups are encrypted with the items inside them and sync across devices."
        }
        onBack={back}
      />

      {selected ? (
        <>
          <View style={styles.actionRow}>
            <Button
              label="Add item"
              icon="plus"
              size="sm"
              fullWidth={false}
              style={{ flex: 1 }}
              onPress={() =>
                router.push({
                  pathname: "/new",
                  params: { group: selected.name },
                })
              }
            />
            <Button
              label="Rename"
              icon="edit-2"
              variant="secondary"
              size="sm"
              fullWidth={false}
              style={{ flex: 1 }}
              onPress={openRename}
            />
            <Button
              label="Delete"
              icon="trash-2"
              variant="danger"
              size="sm"
              fullWidth={false}
              style={{ flex: 1 }}
              onPress={() => {
                setError(null);
                setDeleteOpen(true);
              }}
            />
          </View>

          <View style={{ marginTop: 12 }}>
            {selected.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onPress={() => router.push(`/item/${item.id}`)}
                right={
                  <Feather
                    name="chevron-right"
                    size={17}
                    color={theme.colors.textFaint}
                  />
                }
              />
            ))}
          </View>

          {error ? (
            <Callout tone="danger" body={error} style={{ marginTop: 14 }} />
          ) : null}
        </>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="folder"
          title="No groups yet"
          body="Create a group, then add the first item to it. The group appears as soon as an item is saved."
          actionLabel="Create a group"
          onAction={openCreate}
        />
      ) : (
        <>
          <Card style={{ paddingVertical: 2 }}>
            {groups.map((group, index) => (
              <View key={group.name}>
                <Pressable
                  onPress={() => setSelectedName(group.name)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${group.name} group`}
                  style={({ pressed }) => [
                    styles.groupRow,
                    { opacity: pressed ? 0.65 : 1 },
                  ]}
                >
                  <IconTile
                    icon="folder"
                    seed={group.name}
                    size={38}
                  />
                  <View style={{ flex: 1, gap: 1 }}>
                    <AppText
                      variant="bodyStrong"
                      style={{ fontSize: 14 }}
                      numberOfLines={1}
                    >
                      {group.name}
                    </AppText>
                    <AppText variant="small" style={{ fontSize: 12 }}>
                      {group.count} {group.count === 1 ? "item" : "items"}
                    </AppText>
                  </View>
                  <Feather
                    name="chevron-right"
                    size={17}
                    color={theme.colors.textFaint}
                  />
                </Pressable>
                {index < groups.length - 1 ? (
                  <Divider style={{ marginLeft: 62 }} />
                ) : null}
              </View>
            ))}
          </Card>

          <Button
            label="New group"
            icon="folder-plus"
            style={{ marginTop: 18 }}
            onPress={openCreate}
          />
        </>
      )}

      <Sheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New group"
        subtitle="Name the group, then choose what to add. Groups live inside encrypted items, so a group appears once it has its first item."
        footer={
          <Button
            label="Create and add item"
            icon="arrow-right"
            onPress={createGroup}
            disabled={!newName.trim()}
          />
        }
      >
        <Field
          label="GROUP NAME"
          value={newName}
          onChangeText={(value) => {
            setNewName(value);
            setError(null);
          }}
          placeholder="e.g. Work, Banking, Family"
          icon="folder"
          autoCapitalize="words"
          autoFocus
          error={error}
          returnKeyType="done"
          onSubmitEditing={createGroup}
        />
      </Sheet>

      <Sheet
        visible={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename group"
        subtitle="Items in this group move with it. Other groups are untouched."
        footer={
          <Button
            label="Save name"
            icon="check"
            onPress={submitRename}
            loading={busy}
            disabled={!renameName.trim()}
          />
        }
      >
        <Field
          label="GROUP NAME"
          value={renameName}
          onChangeText={(value) => {
            setRenameName(value);
            setError(null);
          }}
          icon="folder"
          autoCapitalize="words"
          autoFocus
          error={error}
          returnKeyType="done"
          onSubmitEditing={submitRename}
        />
      </Sheet>

      <Sheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this group?"
        subtitle="The group label is removed from every item, but no item is deleted. Items move to No group."
        footer={
          <Button
            label="Delete group"
            icon="trash-2"
            variant="danger"
            onPress={submitDelete}
            loading={busy}
          />
        }
      >
        <Callout
          tone="warning"
          body={`“${selected?.name ?? ""}” has ${selected?.count ?? 0} ${selected?.count === 1 ? "item" : "items"}. They will stay in your vault.`}
        />
        {error ? (
          <Callout tone="danger" body={error} style={{ marginTop: 10 }} />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
});
