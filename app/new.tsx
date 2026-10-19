import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Screen } from "@/components/ui/Screen";
import { useAppTheme } from "@/lib/theme";
import type { VaultItemType } from "@/lib/vault/types";

type FeatherName = ComponentProps<typeof Feather>["name"];

const TYPES: Array<{
  type: VaultItemType;
  icon: FeatherName;
  title: string;
  body: string;
  accent?: boolean;
}> = [
  {
    type: "login",
    icon: "key",
    title: "Login",
    body: "Website, username, password and an optional authenticator.",
    accent: true,
  },
  {
    type: "totp",
    icon: "hash",
    title: "Authenticator",
    body: "Scan a QR code or enter a secret key for 6-digit codes.",
  },
  {
    type: "note",
    icon: "file-text",
    title: "Secure note",
    body: "Free-form encrypted text for anything that isn't a login.",
  },
  {
    type: "card",
    icon: "credit-card",
    title: "Card",
    body: "Card number, holder, expiry and security code.",
  },
  {
    type: "identity",
    icon: "user",
    title: "Identity",
    body: "Name, address, contact details and passport number.",
  },
];

export default function NewItemScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { group } = useLocalSearchParams<{ group?: string }>();
  const groupParam = typeof group === "string" ? group.trim() : "";

  const openType = (type: VaultItemType) => {
    if (type === "totp") {
      router.replace("/scan");
      return;
    }
    router.replace(
      groupParam
        ? `/item/edit?type=${type}&group=${encodeURIComponent(groupParam)}`
        : `/item/edit?type=${type}`
    );
  };

  return (
    <Screen bottomPadding={40}>
      <PageHeader
        eyebrow="New item"
        title="What are you saving?"
        subtitle="Everything is encrypted on this device before it is stored."
        onBack={() => router.back()}
      />

      <View style={{ gap: 10 }}>
        {TYPES.map((entry) => (
          <Pressable
            key={entry.type}
            onPress={() => openType(entry.type)}
            accessibilityRole="button"
            accessibilityLabel={`New ${entry.title}`}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            <Card
              tone={entry.accent ? "accent" : "card"}
              style={{ paddingVertical: 14, paddingHorizontal: 15 }}
            >
              <View style={styles.row}>
                <View
                  style={[
                    styles.icon,
                    {
                      backgroundColor: entry.accent
                        ? theme.colors.accent
                        : theme.colors.cardAlt,
                    },
                  ]}
                >
                  <Feather
                    name={entry.icon}
                    size={20}
                    color={
                      entry.accent ? theme.colors.accentInk : theme.colors.text
                    }
                  />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="h3">{entry.title}</AppText>
                  <AppText variant="small" style={{ fontSize: 12.5 }}>
                    {entry.body}
                  </AppText>
                </View>
                <Feather
                  name="arrow-right"
                  size={17}
                  color={
                    entry.accent ? theme.colors.accent : theme.colors.textFaint
                  }
                />
              </View>
            </Card>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [
          styles.cancel,
          { opacity: pressed ? 0.6 : 1 },
        ]}
        accessibilityRole="button"
      >
        <AppText variant="bodyStrong" color={theme.colors.textMuted}>
          Cancel
        </AppText>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  cancel: {
    alignSelf: "center",
    paddingVertical: 18,
    paddingHorizontal: 24,
  },
});
