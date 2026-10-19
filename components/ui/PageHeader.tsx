import { Feather } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
  onBack,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const theme = useAppTheme();

  return (
    <View style={styles.container}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => [
            styles.back,
            {
              backgroundColor: theme.colors.cardAlt,
              opacity: pressed ? 0.65 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={18} color={theme.colors.text} />
        </Pressable>
      ) : null}

      <View style={styles.textColumn}>
        {eyebrow ? (
          <AppText variant="caption" color={theme.colors.accent}>
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="displaySmall" numberOfLines={1}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" style={styles.subtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>

      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
  style,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  style?: object;
}) {
  const theme = useAppTheme();
  return (
    <View style={[styles.sectionHeader, style]}>
      <AppText variant="caption" color={theme.colors.textMuted}>
        {title}
      </AppText>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <AppText variant="label" color={theme.colors.accent}>
            {action}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 10,
    paddingBottom: 18,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  textColumn: {
    flex: 1,
  },
  subtitle: {
    marginTop: 4,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 26,
    marginBottom: 12,
  },
});
