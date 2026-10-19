import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchBar } from "@/components/ui/SearchBar";
import { Screen } from "@/components/ui/Screen";
import { TotpCard } from "@/components/vault/TotpCard";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { itemMatchesQuery } from "@/lib/vault/presentation";

export default function CodesScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { items } = useVault();
  const [query, setQuery] = useState("");

  const codes = useMemo(
    () => items.filter((item) => Boolean(item.totp?.secret)),
    [items]
  );

  const filtered = useMemo(
    () => codes.filter((item) => itemMatchesQuery(item, query)),
    [codes, query]
  );

  return (
    <Screen>
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

      {codes.length === 0 ? (
        <EmptyState
          icon="hash"
          title="No authenticators yet"
          body="Scan the QR code from a website's security settings, or paste the setup key by hand."
          actionLabel="Scan a QR code"
          onAction={() => router.push("/scan")}
        />
      ) : (
        <>
          <SearchBar
            value={query}
            onChangeText={setQuery}
            placeholder="Search codes"
          />

          <View style={{ gap: 10, marginTop: 16 }}>
            {filtered.map((item) => (
              <TotpCard
                key={item.id}
                item={item}
                onOpen={() => router.push(`/item/${item.id}`)}
              />
            ))}
          </View>

          {filtered.length === 0 ? (
            <EmptyState
              icon="search"
              title="No matching codes"
              body="Try the issuer name or account email."
              actionLabel="Clear search"
              onAction={() => setQuery("")}
              compact
            />
          ) : null}

          <View style={{ marginTop: 22 }}>
            <Button
              label="Add another authenticator"
              variant="secondary"
              icon="plus"
              onPress={() => router.push("/scan")}
            />
          </View>

          <View style={{ alignItems: "center", marginTop: 16 }}>
            <AppText variant="small" style={{ fontSize: 11, opacity: 0.75 }} align="center">
              Codes are generated on this device. The secret never leaves the vault.
            </AppText>
          </View>
        </>
      )}
    </Screen>
  );
}
