import { Tabs } from "expo-router/js-tabs";

import { VaultTabBar } from "@/components/navigation/VaultTabBar";
import { useAppTheme } from "@/lib/theme";

export default function TabsLayout() {
  const theme = useAppTheme();

  return (
    <Tabs
      tabBar={(props) => <VaultTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Vault" }} />
      <Tabs.Screen name="codes" options={{ title: "Codes" }} />
      <Tabs.Screen name="security" options={{ title: "Security" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
