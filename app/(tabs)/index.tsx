import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useDeferredValue, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";

import { AppText } from "@/components/ui/AppText";
import { BrandMark } from "@/components/ui/BrandMark";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { ChipRow } from "@/components/ui/ChipRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { SearchBar } from "@/components/ui/SearchBar";
import { SecurityScoreRing } from "@/components/ui/Rings";
import { Screen } from "@/components/ui/Screen";
import { SectionHeader } from "@/components/ui/PageHeader";
import { ItemRow } from "@/components/vault/ItemRow";
import { greeting, relativeTime, serverHost } from "@/lib/format";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { listGroups } from "@/lib/vault/groups";
import {
  filterItems,
  groupItemsAlphabetically,
} from "@/lib/vault/presentation";
import { analyzeSecurity } from "@/lib/vault/security";
import type { VaultItem } from "@/lib/vault/types";

type VaultRow =
  | {
      key: string;
      kind: "section";
      title: string;
      action?: string;
      onAction?: () => void;
    }
  | { key: string; kind: "letter"; letter: string; count: number }
  | { key: string; kind: "item"; item: VaultItem; favorite?: boolean };

export default function VaultScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const {
    items,
    session,
    syncStatus,
    syncError,
    lastSyncedAt,
    syncNow,
  } = useVault();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [groupFilter, setGroupFilter] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const deferredQuery = useDeferredValue(query);

  const report = useMemo(() => analyzeSecurity(items), [items]);
  const favorites = useMemo(
    () => items.filter((item) => item.favorite && !item.deletedAt),
    [items]
  );
  const counts = useMemo(() => {
    let logins = 0;
    let cards = 0;
    let notes = 0;
    let codes = 0;
    for (const item of items) {
      if (item.type === "login") logins += 1;
      if (item.type === "card") cards += 1;
      if (item.type === "note" || item.type === "identity") notes += 1;
      if (item.totp?.secret) codes += 1;
    }
    return { logins, cards, notes, codes };
  }, [items]);
  const groupsList = useMemo(() => listGroups(items), [items]);
  const groupKeys = useMemo(
    () => new Set(groupsList.map((group) => group.name)),
    [groupsList]
  );
  const activeGroup = groupKeys.has(groupFilter) ? groupFilter : "";

  const filtered = useMemo(
    () =>
      filterItems(items, category, deferredQuery).filter(
        (item) => !activeGroup || item.folder?.trim() === activeGroup
      ),
    [items, category, deferredQuery, activeGroup]
  );
  const groups = useMemo(() => groupItemsAlphabetically(filtered), [filtered]);
  const searching = deferredQuery.trim().length > 0;

  const options = useMemo(
    () => [
      { key: "all", label: "All", count: items.length },
      { key: "favorites", label: "Favorites", icon: "star" as const, count: favorites.length },
      { key: "logins", label: "Logins", count: counts.logins },
      { key: "codes", label: "2FA", icon: "hash" as const, count: counts.codes },
      { key: "cards", label: "Cards", count: counts.cards },
      { key: "notes", label: "Notes", count: counts.notes },
    ],
    [items.length, favorites.length, counts]
  );

  const rows = useMemo<VaultRow[]>(() => {
    const next: VaultRow[] = [];
    if (!searching && category === "all" && !activeGroup && favorites.length > 0) {
      next.push({
        key: "pinned-header",
        kind: "section",
        title: "Pinned",
        action: favorites.length > 4 ? "View all" : undefined,
        onAction: () => setCategory("favorites"),
      });
      for (const item of favorites.slice(0, 4)) {
        next.push({ key: `fav-${item.id}`, kind: "item", item, favorite: true });
      }
    }

    if (searching) {
      next.push({
        key: "search-header",
        kind: "section",
        title: `${filtered.length} ${filtered.length === 1 ? "result" : "results"}`,
      });
    }

    for (const group of groups) {
      if (!searching) {
        next.push({
          key: `letter-${group.letter}`,
          kind: "letter",
          letter: group.letter,
          count: group.items.length,
        });
      }
      for (const item of group.items) {
        next.push({ key: item.id, kind: "item", item });
      }
    }
    return next;
  }, [searching, category, activeGroup, favorites, filtered.length, groups]);

  const refresh = async () => {
    if (!session?.token) return;
    setRefreshing(true);
    try {
      await syncNow();
    } catch {
      // syncError state carries the message
    } finally {
      setRefreshing(false);
    }
  };

  const syncLabel = !session
    ? "Local only"
    : syncStatus === "syncing"
      ? "Syncing…"
      : syncStatus === "error"
        ? "Sync needs attention"
        : lastSyncedAt
          ? `Synced ${relativeTime(lastSyncedAt)}`
          : "Ready to sync";

  const syncIcon = !session
    ? "cloud-off"
    : syncStatus === "syncing"
      ? "refresh-cw"
      : syncStatus === "error"
        ? "alert-circle"
        : "check-circle";

  const initial = (session?.email?.[0] || "F").toUpperCase();

  const header = (
    <>
      <View style={styles.topRow}>
        <View style={styles.brand}>
          <BrandMark size={30} />
          <AppText variant="h3" style={{ letterSpacing: -0.2 }}>
            FlexiVault
          </AppText>
        </View>

        <Pressable
          onPress={() => router.push("/(tabs)/settings")}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          style={({ pressed }) => [
            styles.avatar,
            {
              backgroundColor: theme.colors.cardAlt,
              borderColor: theme.colors.borderStrong,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
            {initial}
          </AppText>
          <View
            style={[
              styles.avatarDot,
              {
                backgroundColor: session ? theme.colors.accent : theme.colors.warning,
                borderColor: theme.colors.background,
              },
            ]}
          />
        </Pressable>
      </View>

      <View style={{ marginTop: 20 }}>
        <AppText variant="caption" color={theme.colors.accent}>
          {greeting()}
        </AppText>
        <AppText variant="display" style={{ fontSize: 46, lineHeight: 48 }}>
          Your vault.
        </AppText>
        <AppText variant="small" style={{ marginTop: 4 }}>
          {items.length} {items.length === 1 ? "item" : "items"} · end-to-end encrypted
          {session ? ` · ${serverHost(session.url)}` : ""}
        </AppText>
      </View>

      <View style={styles.statusRow}>
        <Pressable
          onPress={() => {
            if (session?.token) {
              syncNow().catch(() => {});
            } else {
              router.push("/settings/server");
            }
          }}
          style={({ pressed }) => [
            styles.statusPill,
            {
              backgroundColor:
                syncStatus === "error" ? theme.colors.dangerSoft : theme.colors.card,
              borderColor:
                syncStatus === "error" ? "transparent" : theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather
            name={syncIcon}
            size={13}
            color={
              syncStatus === "error"
                ? theme.colors.danger
                : session
                  ? theme.colors.accent
                  : theme.colors.textMuted
            }
          />
          <AppText
            variant="label"
            color={syncStatus === "error" ? theme.colors.danger : theme.colors.textMuted}
          >
            {syncLabel}
          </AppText>
        </Pressable>

        <Pressable
          onPress={() => router.push("/(tabs)/codes")}
          style={({ pressed }) => [
            styles.statusPill,
            {
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Feather name="hash" size={13} color={theme.colors.accent} />
          <AppText variant="label" color={theme.colors.textMuted}>
            {counts.codes} {counts.codes === 1 ? "code" : "codes"} live
          </AppText>
        </Pressable>
      </View>

      {syncError ? (
        <Callout tone="danger" body={syncError} style={{ marginTop: 12 }} />
      ) : null}

      <Pressable
        onPress={() => router.push("/(tabs)/security")}
        style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, marginTop: 16 }]}
        accessibilityRole="button"
        accessibilityLabel="Open security report"
      >
        <Card tone="accent" style={{ paddingVertical: 14, paddingHorizontal: 15 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <SecurityScoreRing score={report.score} size={58} />
            <View style={{ flex: 1, gap: 3 }}>
              <AppText variant="bodyStrong">Vault health</AppText>
              <AppText variant="small" style={{ fontSize: 12.5 }}>
                {report.label} · {report.weak.length} weak ·{" "}
                {report.reused.length} reused
              </AppText>
            </View>
            <Feather name="arrow-up-right" size={17} color={theme.colors.accent} />
          </View>
        </Card>
      </Pressable>

      <View style={{ marginTop: 18 }}>
        <SearchBar value={query} onChangeText={setQuery} />
      </View>

      <ChipRow
        options={options}
        value={category}
        onChange={setCategory}
        style={{ marginTop: 12 }}
      />

      {groupsList.length > 0 ? (
        <>
          <SectionHeader
            title="Groups"
            action="Manage"
            onAction={() => router.push("/groups")}
          />
          <ChipRow
            options={[
              { key: "", label: "All groups", count: items.length },
              ...groupsList.map((group) => ({
                key: group.name,
                label: group.name,
                count: group.count,
              })),
            ]}
            value={activeGroup}
            onChange={setGroupFilter}
          />
        </>
      ) : null}
    </>
  );

  const empty =
    items.length === 0 ? (
      <EmptyState
        icon="shield"
        title="A clean slate"
        body="Add a login, a secure note, or your first authenticator. Everything is encrypted before it touches the disk."
        actionLabel="Add your first item"
        onAction={() => router.push("/new")}
      />
    ) : filtered.length === 0 ? (
      <EmptyState
        icon="search"
        title={searching ? "Nothing matches" : "Nothing here yet"}
        body={
          searching
            ? "Try a different name, username or website."
            : "Add an item to this category, or switch filters."
        }
        actionLabel={searching ? "Clear search" : "Add an item"}
        onAction={() => {
          if (searching) setQuery("");
          else router.push("/new");
        }}
        compact
      />
    ) : null;

  const renderRow = ({ item: row }: { item: VaultRow }) => {
    if (row.kind === "section") {
      return (
        <SectionHeader
          title={row.title}
          action={row.action}
          onAction={row.onAction}
        />
      );
    }
    if (row.kind === "letter") {
      return (
        <View style={styles.letterRow}>
          <AppText variant="caption" color={theme.colors.accent}>
            {row.letter}
          </AppText>
          <View
            style={[styles.letterLine, { backgroundColor: theme.colors.border }]}
          />
          <AppText variant="caption" style={{ opacity: 0.6 }}>
            {row.count}
          </AppText>
        </View>
      );
    }

    return (
      <ItemRow
        item={row.item}
        onPress={() => router.push(`/item/${row.item.id}`)}
        right={
          row.favorite ? (
            <Feather name="star" size={15} color={theme.colors.warning} />
          ) : row.item.totp?.secret && row.item.type !== "totp" ? (
            <View
              style={[
                styles.twoFa,
                {
                  backgroundColor: theme.colors.accentFaint,
                  borderColor: theme.colors.border,
                },
              ]}
            >
              <Feather name="hash" size={11} color={theme.colors.accent} />
              <AppText
                variant="caption"
                color={theme.colors.accent}
                style={{ fontSize: 9 }}
              >
                2FA
              </AppText>
            </View>
          ) : row.item.favorite ? (
            <Feather name="star" size={14} color={theme.colors.warning} />
          ) : (
            <Feather
              name="chevron-right"
              size={17}
              color={theme.colors.textFaint}
            />
          )
        }
      />
    );
  };

  return (
    <Screen scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={renderRow}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: 120,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        refreshControl={
          session?.token ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refresh}
              tintColor={theme.colors.accent}
              colors={[theme.colors.accent]}
              progressBackgroundColor={theme.colors.card}
            />
          ) : undefined
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    right: 0,
    bottom: 0,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  letterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 18,
    marginBottom: 3,
    paddingHorizontal: 4,
  },
  letterLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  twoFa: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
  },
});
