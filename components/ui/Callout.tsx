import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { View } from "react-native";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";

type Tone = "info" | "warning" | "danger" | "success";

const ICONS: Record<Tone, ComponentProps<typeof Feather>["name"]> = {
  info: "info",
  warning: "alert-triangle",
  danger: "shield-off",
  success: "check-circle",
};

export function Callout({
  tone = "info",
  title,
  body,
  icon,
  style,
}: {
  tone?: Tone;
  title?: string;
  body: string;
  icon?: ComponentProps<typeof Feather>["name"];
  style?: object;
}) {
  const theme = useAppTheme();
  const foreground =
    tone === "danger"
      ? theme.colors.danger
      : tone === "warning"
        ? theme.colors.warning
        : tone === "success"
          ? theme.colors.accent
          : theme.colors.info;
  const background =
    tone === "danger"
      ? theme.colors.dangerSoft
      : tone === "warning"
        ? theme.colors.warningSoft
        : tone === "success"
          ? theme.colors.accentSoft
          : theme.colors.infoSoft;

  return (
    <View
      style={[
        {
          flexDirection: "row",
          gap: 11,
          padding: 14,
          borderRadius: theme.radius.md,
          backgroundColor: background,
        },
        style,
      ]}
    >
      <Feather
        name={icon ?? ICONS[tone]}
        size={16}
        color={foreground}
        style={{ marginTop: 1 }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <AppText variant="bodyStrong" color={foreground} style={{ fontSize: 13 }}>
            {title}
          </AppText>
        ) : null}
        <AppText
          variant="small"
          color={foreground}
          style={{ fontSize: 13, lineHeight: 19, opacity: 0.92 }}
        >
          {body}
        </AppText>
      </View>
    </View>
  );
}
