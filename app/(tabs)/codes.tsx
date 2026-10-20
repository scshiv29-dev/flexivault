import { useRouter } from "expo-router";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import { FlatList, Platform, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchBar } from "@/components/ui/SearchBar";
import { Screen } from "@/components/ui/Screen";
import { TotpCard } from "@/components/vault/TotpCard";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { filterItems } from "@/lib/vault/presentation";
import type { VaultItem } from "@/lib/vault/types";

const Separator = () => <View style={{ height: 10 }} />;
const keyExtractor = (item: VaultItem) => item.id;

export default function CodesScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { items } = useVault();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const codes = useMemo(
    () => items.filter((item) => Boolean(item.totp?.secret)),
    [items]
  );

  const filtered = useMemo(
    () => filterItems(codes, "all", deferredQuery),
    [codes, deferredQuery]
  );

  const renderCode = useCallback(
    ({ item }: { item: VaultItem }) => (
      <TotpCard item={item} onOpen={() => router.push(`/item/${item.id}`)} />
    ),
    [router]
  );

  const header = (
    <>
      <PageHeader
        eyebrow="Authenticator"
        title="Codes"
        subtitle={
          codes.length > 0
            ? `${codes.length} ${codes.length === 1 ? "code" : "codes"} refreshing on one clock`
            : "Two-factor codes, beside your logins"
        }
        right={
          <IconButton
            icon="maximize"
            accessibilityLabel="Scan a QR code"
            onPress={() => router.push("/scan")}
            background={theme.colors.accentSoft}
            color={theme.colors.accent}
          />
        }
      />
      {codes.length > 0 ? (
        <View style={{ marginBottom: 16 }}>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder="Search codes"
          />
        </View>
      ) : null}
    </>
  );

  const empty =
    codes.length === 0 ? (
      <EmptyState
        icon="hash"
        title="No authenticators yet"
        body="Scan the QR code from a website's security settings, or paste the setup key by hand."
        actionLabel="Scan a QR code"
        onAction={() => router.push("/scan")}
      />
    ) : (
      <EmptyState
        icon="search"
        title="No matching codes"
        body="Try the issuer name or account email."
        actionLabel="Clear search"
        onAction={() => setQuery("")}
        compact
      />
    );

  const footer =
    codes.length > 0 ? (
      <>
        <View style={{ marginTop: 22 }}>
          <Button
            label="Add another authenticator"
            variant="secondary"
            icon="plus"
            onPress={() => router.push("/scan")}
          />
        </View>

        <View style={{ alignItems: "center", marginTop: 16 }}>
          <AppText
            variant="small"
            style={{ fontSize: 11, opacity: 0.75 }}
            align="center"
          >
            Codes are generated on this device. The secret never leaves the vault.
          </AppText>
        </View>
      </>
    ) : null;

  return (
    <Screen scroll={false}>
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderCode}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        ItemSeparatorComponent={Separator}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: 120,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={5}
      />
    </Screen>
  );
}
