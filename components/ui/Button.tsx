import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRef, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";

type FeatherName = ComponentProps<typeof Feather>["name"];

export type ButtonVariant = "primary" | "secondary" | "ghost" | "soft" | "danger";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: FeatherName;
  iconRight?: FeatherName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: "md" | "sm";
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  iconRight,
  loading = false,
  disabled = false,
  fullWidth = true,
  size = "md",
  style,
  testID,
}: ButtonProps) {
  const theme = useAppTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const isDisabled = disabled || loading;

  const palette = {
    primary: {
      background: theme.colors.accent,
      border: theme.colors.accent,
      foreground: theme.colors.accentInk,
    },
    secondary: {
      background: theme.colors.card,
      border: theme.colors.borderStrong,
      foreground: theme.colors.text,
    },
    ghost: {
      background: "transparent",
      border: "transparent",
      foreground: theme.colors.textMuted,
    },
    soft: {
      background: theme.colors.accentSoft,
      border: "transparent",
      foreground: theme.colors.accent,
    },
    danger: {
      background: theme.colors.dangerSoft,
      border: "transparent",
      foreground: theme.colors.danger,
    },
  }[variant];

  return (
    <Animated.View
      style={[
        { width: fullWidth ? "100%" : undefined, transform: [{ scale }] },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID={testID}
        disabled={isDisabled}
        onPressIn={() => {
          if (isDisabled) return;
          Animated.spring(scale, {
            toValue: 0.97,
            useNativeDriver: true,
            speed: 40,
            bounciness: 0,
          }).start();
        }}
        onPressOut={() => {
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: true,
            speed: 40,
            bounciness: 6,
          }).start();
        }}
        onPress={() => {
          if (isDisabled) return;
          if (Platform.OS !== "web") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          }
          onPress?.();
        }}
        style={({ pressed }) => [
          styles.base,
          {
            backgroundColor: palette.background,
            borderColor: palette.border,
            opacity: isDisabled ? 0.5 : pressed ? 0.9 : 1,
            minHeight: size === "sm" ? 42 : 54,
            paddingHorizontal: size === "sm" ? 14 : 20,
            borderRadius: size === "sm" ? theme.radius.md : theme.radius.lg,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={palette.foreground} />
        ) : (
          <View style={styles.content}>
            {icon ? (
              <Feather name={icon} size={17} color={palette.foreground} />
            ) : null}
            <AppText variant="button" color={palette.foreground}>
              {label}
            </AppText>
            {iconRight ? (
              <Feather name={iconRight} size={17} color={palette.foreground} />
            ) : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color,
  background,
  size = 40,
  iconSize = 19,
  style,
}: {
  icon: FeatherName;
  onPress?: () => void;
  accessibilityLabel: string;
  color?: string;
  background?: string;
  size?: number;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background ?? theme.colors.cardAlt,
          opacity: pressed ? 0.65 : 1,
        },
        style,
      ]}
    >
      <Feather name={icon} size={iconSize} color={color ?? theme.colors.text} />
    </Pressable>
  );
}

export function LinkButton({
  label,
  onPress,
  icon,
  color,
}: {
  label: string;
  onPress?: () => void;
  icon?: FeatherName;
  color?: string;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.linkButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AppText variant="bodyStrong" color={color ?? theme.colors.accent}>
        {label}
      </AppText>
      {icon ? (
        <Feather
          name={icon}
          size={15}
          color={color ?? theme.colors.accent}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
  },
  linkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 6,
  },
});
