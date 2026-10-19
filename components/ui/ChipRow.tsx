import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";

export interface ChipOption {
  key: string;
  label: string;
  icon?: ComponentProps<typeof Feather>["name"];
  count?: number;
}

export function ChipRow({
  options,
  value,
  onChange,
  style,
}: {
  options: ChipOption[];
  value: string;
  onChange: (key: string) => void;
  style?: object;
}) {
  const theme = useAppTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, style]}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected
                  ? theme.colors.accentSoft
                  : theme.colors.cardAlt,
                borderColor: selected ? theme.colors.accent : "transparent",
                borderRadius: theme.radius.full,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            {option.icon ? (
              <Feather
                name={option.icon}
                size={13}
                color={selected ? theme.colors.accent : theme.colors.textMuted}
              />
            ) : null}
            <AppText
              variant="label"
              color={selected ? theme.colors.accent : theme.colors.textMuted}
            >
              {option.label}
            </AppText>
            {option.count !== undefined ? (
              <View
                style={[
                  styles.count,
                  {
                    backgroundColor: selected
                      ? theme.colors.accent
                      : theme.colors.cardStrong,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  color={selected ? theme.colors.accentInk : theme.colors.textMuted}
                  style={styles.countText}
                >
                  {option.count}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 8,
    paddingVertical: 2,
    paddingRight: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1,
    paddingHorizontal: 13,
    height: 36,
  },
  count: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: {
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0,
  },
});
