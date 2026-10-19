import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useAppTheme } from "@/lib/theme";

export function Card({
  children,
  style,
  tone = "card",
  padded = true,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: "card" | "alt" | "accent" | "strong";
  padded?: boolean;
}) {
  const theme = useAppTheme();
  const backgroundColor =
    tone === "accent"
      ? theme.colors.accentSoft
      : tone === "alt"
        ? theme.colors.cardAlt
        : tone === "strong"
          ? theme.colors.cardStrong
          : theme.colors.card;

  return (
    <View
      style={[
        styles.card,
        theme.shadow.card,
        {
          backgroundColor,
          borderColor: theme.colors.border,
          borderRadius: theme.radius.xl,
          padding: padded ? theme.spacing.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: "hidden",
  },
});
