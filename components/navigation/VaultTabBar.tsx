import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import * as Haptics from "expo-haptics";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ComponentProps } from "react";

import { useAppTheme } from "@/lib/theme";

const TAB_META: Record<
  string,
  { label: string; icon: ComponentProps<typeof Feather>["name"] }
> = {
  index: { label: "Vault", icon: "grid" },
  codes: { label: "Codes", icon: "hash" },
  security: { label: "Security", icon: "shield" },
  settings: { label: "Settings", icon: "sliders" },
};

export function VaultTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const renderTab = (route: (typeof state.routes)[number], index: number) => {
    const meta = TAB_META[route.name] ?? {
      label: route.name,
      icon: "circle" as const,
    };
    const focused = state.index === index;

    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        accessibilityLabel={meta.label}
        onPress={() => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        }}
        style={({ pressed }) => [
          styles.tab,
          {
            backgroundColor: focused ? theme.colors.accentFaint : "transparent",
            opacity: pressed ? 0.65 : 1,
          },
        ]}
      >
        <Feather
          name={meta.icon}
          size={19}
          color={focused ? theme.colors.accent : theme.colors.textFaint}
        />
        <View
          style={[
            styles.dot,
            {
              backgroundColor: focused
                ? theme.colors.accent
                : "transparent",
            },
          ]}
        />
      </Pressable>
    );
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: Math.max(insets.bottom, 10) }]}
    >
      <View
        style={[
          styles.bar,
          theme.shadow.floating,
          {
            backgroundColor: theme.colors.tabBar,
            borderColor: theme.colors.border,
          },
        ]}
      >
        {state.routes.slice(0, 2).map((route, index) => renderTab(route, index))}

        <View style={styles.addSlot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add to vault"
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
                  () => {}
                );
              }
              router.push("/new");
            }}
            style={({ pressed }) => [
              styles.add,
              {
                backgroundColor: theme.colors.accent,
                borderColor: theme.colors.background,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="plus" size={24} color={theme.colors.accentInk} />
          </Pressable>
        </View>

        {state.routes.slice(2).map((route, index) => renderTab(route, index + 2))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 14,
    right: 14,
  },
  bar: {
    height: 68,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 5,
  },
  tab: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
  },
  addSlot: {
    width: 66,
    alignItems: "center",
    justifyContent: "center",
  },
  add: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -2,
  },
});
