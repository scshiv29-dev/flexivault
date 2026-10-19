import { Stack, useRouter } from "expo-router";
import { View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";

export default function NotFoundScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen options={{ title: "Not found", headerShown: false }} />
      <Screen scroll={false} edges={["top", "bottom"]} bottomPadding={0}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState
            icon="compass"
            title="This screen doesn't exist"
            body="The link may be old, or the item was removed on another device."
            actionLabel="Back to your vault"
            onAction={() => router.replace("/(tabs)")}
          />
        </View>
      </Screen>
    </>
  );
}
