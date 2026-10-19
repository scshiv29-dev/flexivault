import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { View } from "react-native";

import { AuthShell } from "@/components/auth/AuthShell";
import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { IconTile } from "@/components/ui/IconTile";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";

const FEATURES = [
  {
    icon: "key" as const,
    title: "Passwords and passphrases",
    body: "A generator that makes long, unique secrets the default.",
  },
  {
    icon: "hash" as const,
    title: "Authenticator built in",
    body: "TOTP codes live beside the logins they protect.",
  },
  {
    icon: "server" as const,
    title: "Your server, your rules",
    body: "Sync through a self-hosted server. We never see the keys.",
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { legacyCount } = useVault();

  return (
    <AuthShell
      footer={
        <View style={{ alignItems: "center", gap: 8 }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Feather name="lock" size={12} color={theme.colors.textFaint} />
            <AppText variant="small" style={{ fontSize: 11 }}>
              Zero-knowledge · AES-256-GCM · Self-hostable
            </AppText>
          </View>
          <AppText variant="small" style={{ fontSize: 11, opacity: 0.8 }}>
            v1.0 · Designed for the paranoid
          </AppText>
        </View>
      }
    >
      <View
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          backgroundColor: theme.colors.accentFaint,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 999,
          paddingHorizontal: 11,
          paddingVertical: 6,
          marginBottom: 18,
        }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: theme.colors.accent,
          }}
        />
        <AppText variant="caption" color={theme.colors.accent} style={{ fontSize: 9 }}>
          Private by default
        </AppText>
      </View>

      <AppText
        variant="display"
        style={{ fontSize: 48, lineHeight: 50, letterSpacing: -1 }}
      >
        Every password.{"\n"}Every code.{"\n"}One quiet place.
      </AppText>

      <AppText variant="body" style={{ marginTop: 16, maxWidth: 330, lineHeight: 23 }}>
        FlexiVault keeps logins, cards, notes and two-factor codes encrypted on your
        device — and syncs through a server you control.
      </AppText>

      <View style={{ marginTop: 30, gap: 10 }}>
        {FEATURES.map((feature) => (
          <View
            key={feature.title}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 13,
              padding: 13,
              borderRadius: theme.radius.lg,
              backgroundColor: theme.colors.card,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <IconTile icon={feature.icon} seed={feature.title} size={40} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
                {feature.title}
              </AppText>
              <AppText variant="small" style={{ fontSize: 12, lineHeight: 17 }}>
                {feature.body}
              </AppText>
            </View>
          </View>
        ))}
      </View>

      {legacyCount > 0 ? (
        <Callout
          tone="info"
          title={`${legacyCount} authenticator${legacyCount === 1 ? "" : "s"} found`}
          body="Codes from the previous app will be imported automatically when you create your vault."
          style={{ marginTop: 16 }}
        />
      ) : null}

      <View style={{ marginTop: 26, gap: 10 }}>
        <Button
          label="Create your vault"
          icon="arrow-right"
          onPress={() => router.push("/(auth)/create-vault")}
        />
        <Button
          label="Sign in to a server"
          variant="secondary"
          icon="cloud"
          onPress={() => router.push("/(auth)/connect")}
        />
      </View>
    </AuthShell>
  );
}
