import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { useToast } from "@/components/ui/Toast";
import { AppText } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Card";
import { IconTile } from "@/components/ui/IconTile";
import { ProgressRing } from "@/components/ui/Rings";
import { useClock } from "@/lib/state/clock";
import { useAppTheme } from "@/lib/theme";
import { formatTotpCode, generateTotp, secondsRemaining } from "@/lib/vault/otp";
import { itemIcon } from "@/lib/vault/presentation";
import { VaultItem } from "@/lib/vault/types";

export function TotpCard({
  item,
  onOpen,
}: {
  item: VaultItem;
  onOpen?: () => void;
}) {
  const theme = useAppTheme();
  const toast = useToast();
  const now = useClock();
  const [error, setError] = useState<string | null>(null);

  const totp = item.totp;
  const period = totp?.period && totp.period > 0 ? totp.period : 30;
  const step = Math.floor(now / 1000 / period);
  // The HMAC only changes once per TOTP step. Keep it memoized on the step so
  // the once-per-second countdown does not rehash every mounted card.
  const code = useMemo(() => {
    if (!totp?.secret) return null;
    try {
      return generateTotp(totp, step * period * 1000);
    } catch {
      return null;
    }
  }, [totp, period, step]);

  if (!totp?.secret) return null;

  if (!code) {
    return (
      <Card>
        <AppText variant="small" color={theme.colors.danger}>
          This authenticator has an invalid secret.
        </AppText>
      </Card>
    );
  }

  const remaining = secondsRemaining(period, now);
  const progress = remaining / period;
  const urgent = remaining <= 5;
  const ringColor = urgent ? theme.colors.danger : theme.colors.accent;

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => {}
        );
      }
      toast.show("Code copied", "success");
    } catch {
      setError("Could not copy the code.");
    }
  };

  return (
    <Card style={{ paddingVertical: 15, paddingHorizontal: 15 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <IconTile
          icon={itemIcon(item) as any}
          seed={item.name || item.id}
          size={42}
        />
        <Pressable style={{ flex: 1 }} onPress={onOpen} disabled={!onOpen}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {item.name}
          </AppText>
          <AppText variant="small" numberOfLines={1} style={{ fontSize: 12 }}>
            {totp.issuer || totp.label || item.username || "Authenticator"}
          </AppText>
        </Pressable>
        <ProgressRing
          size={42}
          stroke={3.5}
          progress={progress}
          color={ringColor}
        >
          <AppText
            style={{
              fontFamily: theme.font.mono,
              fontSize: 12,
              color: urgent ? theme.colors.danger : theme.colors.textMuted,
            }}
          >
            {remaining}
          </AppText>
        </ProgressRing>
      </View>

      <Pressable
        onPress={copy}
        style={({ pressed }) => [
          styles.codeRow,
          {
            backgroundColor: theme.colors.cardAlt,
            borderRadius: theme.radius.md,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Copy code"
      >
        <AppText
          style={{
            fontFamily: theme.font.mono,
            fontSize: 27,
            letterSpacing: 2.2,
            color: urgent ? theme.colors.danger : theme.colors.text,
          }}
        >
          {formatTotpCode(code)}
        </AppText>
        <Feather name="copy" size={15} color={theme.colors.textMuted} />
      </Pressable>

      <View
        style={{
          height: 3,
          borderRadius: 2,
          backgroundColor: theme.colors.cardStrong,
          overflow: "hidden",
          marginTop: 11,
        }}
      >
        <View
          style={{
            width: `${Math.max(0, Math.min(100, progress * 100))}%`,
            height: "100%",
            backgroundColor: ringColor,
            borderRadius: 2,
          }}
        />
      </View>

      {error ? (
        <AppText variant="small" color={theme.colors.danger} style={{ marginTop: 8 }}>
          {error}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 15,
    paddingVertical: 12,
    marginTop: 13,
  },
});
