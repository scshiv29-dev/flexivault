import { Text, type TextProps, type TextStyle } from "react-native";

import { useAppTheme, type AppTheme } from "@/lib/theme";

export type TextVariant =
  | "display"
  | "displaySmall"
  | "h1"
  | "h2"
  | "h3"
  | "body"
  | "bodyStrong"
  | "small"
  | "caption"
  | "label"
  | "button"
  | "mono"
  | "code";

function variantStyle(theme: AppTheme, variant: TextVariant): TextStyle {
  const { colors, font } = theme;
  switch (variant) {
    case "display":
      return {
        fontFamily: font.display,
        fontSize: 46,
        lineHeight: 48,
        color: colors.text,
        letterSpacing: -0.5,
      };
    case "displaySmall":
      return {
        fontFamily: font.display,
        fontSize: 34,
        lineHeight: 38,
        color: colors.text,
        letterSpacing: -0.2,
      };
    case "h1":
      return {
        fontFamily: font.bold,
        fontSize: 26,
        lineHeight: 32,
        color: colors.text,
        letterSpacing: -0.5,
      };
    case "h2":
      return {
        fontFamily: font.bold,
        fontSize: 20,
        lineHeight: 26,
        color: colors.text,
        letterSpacing: -0.25,
      };
    case "h3":
      return {
        fontFamily: font.medium,
        fontSize: 16,
        lineHeight: 22,
        color: colors.text,
      };
    case "body":
      return {
        fontFamily: font.sans,
        fontSize: 15,
        lineHeight: 22,
        color: colors.text,
      };
    case "bodyStrong":
      return {
        fontFamily: font.medium,
        fontSize: 15,
        lineHeight: 22,
        color: colors.text,
      };
    case "small":
      return {
        fontFamily: font.sans,
        fontSize: 13,
        lineHeight: 19,
        color: colors.textMuted,
      };
    case "caption":
      return {
        fontFamily: font.medium,
        fontSize: 11,
        lineHeight: 15,
        color: colors.textMuted,
        letterSpacing: 0.8,
        textTransform: "uppercase",
      };
    case "label":
      return {
        fontFamily: font.medium,
        fontSize: 12,
        lineHeight: 16,
        color: colors.textMuted,
        letterSpacing: 0.2,
      };
    case "button":
      return {
        fontFamily: font.bold,
        fontSize: 15,
        lineHeight: 20,
        letterSpacing: 0.1,
      };
    case "mono":
      return {
        fontFamily: font.mono,
        fontSize: 15,
        lineHeight: 22,
        color: colors.text,
        letterSpacing: 0.2,
      };
    case "code":
      return {
        fontFamily: font.mono,
        fontSize: 30,
        lineHeight: 38,
        color: colors.text,
        letterSpacing: 1.4,
      };
  }
}

export interface AppTextProps extends TextProps {
  variant?: TextVariant;
  color?: string;
  align?: TextStyle["textAlign"];
}

export function AppText({
  variant = "body",
  color,
  align,
  style,
  ...rest
}: AppTextProps) {
  const theme = useAppTheme();
  return (
    <Text
      {...rest}
      style={[
        variantStyle(theme, variant),
        color ? { color } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
    />
  );
}
