import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { View } from "react-native";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";
import { Button } from "./Button";

export function EmptyState({
  icon = "inbox",
  title,
  body,
  actionLabel,
  onAction,
  compact = false,
}: {
  icon?: ComponentProps<typeof Feather>["name"];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  const theme = useAppTheme();

  return (
    <View
      style={{
        alignItems: "center",
        paddingVertical: compact ? 32 : 56,
        paddingHorizontal: 24,
      }}
    >
      <View
        style={{
          width: compact ? 56 : 72,
          height: compact ? 56 : 72,
          borderRadius: compact ? 20 : 26,
          backgroundColor: theme.colors.accentFaint,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 18,
        }}
      >
        <Feather
          name={icon}
          size={compact ? 22 : 28}
          color={theme.colors.accent}
        />
      </View>
      <AppText variant="h2" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText
          variant="small"
          align="center"
          style={{ marginTop: 7, maxWidth: 280 }}
        >
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          label={actionLabel}
          onPress={onAction}
          fullWidth={false}
          size="sm"
          style={{ marginTop: 20 }}
        />
      ) : null}
    </View>
  );
}
