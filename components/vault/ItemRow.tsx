import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { useAppTheme } from "@/lib/theme";
import { itemIcon, itemSubtitle } from "@/lib/vault/presentation";
import { VaultItem } from "@/lib/vault/types";
import { AppText } from "@/components/ui/AppText";
import { IconTile } from "@/components/ui/IconTile";

export function ItemRow({
  item,
  onPress,
  onLongPress,
  showChevron = true,
  right,
}: {
  item: VaultItem;
  onPress?: () => void;
  onLongPress?: () => void;
  showChevron?: boolean;
  right?: React.ReactNode;
}) {
  const theme = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${itemSubtitle(item)}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.colors.cardAlt : "transparent",
          borderRadius: theme.radius.md,
        },
      ]}
    >
      <IconTile icon={itemIcon(item) as any} seed={item.name || item.id} size={44} />

      <View style={styles.text}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {item.name || "Untitled"}
          </AppText>
          {item.favorite ? (
            <Feather name="star" size={11} color={theme.colors.warning} />
          ) : null}
        </View>
        <AppText variant="small" numberOfLines={1} style={{ fontSize: 12.5 }}>
          {itemSubtitle(item)}
        </AppText>
      </View>

      {right ? (
        right
      ) : showChevron ? (
        <Feather name="chevron-right" size={17} color={theme.colors.textFaint} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 9,
    paddingHorizontal: 4,
  },
  text: {
    flex: 1,
    gap: 2,
  },
});
