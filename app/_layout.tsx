import { useFonts } from "expo-font";
import {
  Stack,
  useGlobalSearchParams,
  useRootNavigationState,
  useRouter,
  useSegments,
} from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar, type StatusBarStyle } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { BootSplash } from "@/components/BootSplash";
import { ToastProvider } from "@/components/ui/Toast";
import { ClockProvider } from "@/lib/state/clock";
import { VaultProvider, useVault } from "@/lib/state/vault-provider";
import { AppThemeProvider, useAppTheme } from "@/lib/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { status } = useVault();
  const theme = useAppTheme();
  const segments = useSegments() as string[];
  const router = useRouter();
  const navigationState = useRootNavigationState();
  const linkParams = useGlobalSearchParams<{ server?: string; email?: string; invite?: string }>();

  useEffect(() => {
    if (!navigationState?.key) return;

    const group = segments[0];
    const screen = segments[1];
    const inAuth = group === "(auth)";

    if (status === "onboarding" && !inAuth) {
      router.replace("/(auth)/welcome");
      return;
    }

    if (status === "onboarding" && inAuth && screen === "unlock") {
      router.replace("/(auth)/welcome");
      return;
    }

    if (status === "locked" && !(inAuth && screen === "unlock")) {
      router.replace("/(auth)/unlock");
      return;
    }

    if (status === "unlocked" && inAuth) {
      router.replace("/(tabs)");
      // A flexivault://connect link opened on a phone that already has a
      // vault: take the details to Settings → Server instead of dropping them.
      if (screen === "connect" && typeof linkParams.server === "string" && linkParams.server) {
        router.push({
          pathname: "/settings/server",
          params: {
            server: linkParams.server,
            email: typeof linkParams.email === "string" ? linkParams.email : "",
            invite: typeof linkParams.invite === "string" ? linkParams.invite : "",
          },
        });
      }
    }
  }, [status, segments, navigationState?.key, router, linkParams.server, linkParams.email, linkParams.invite]);

  if (status === "loading") return <BootSplash />;

  return (
    <>
      <StatusBar style={theme.statusBar as StatusBarStyle} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
          animation: "fade",
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="new"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen name="scan" options={{ presentation: "modal" }} />
        <Stack.Screen
          name="import"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen
          name="groups"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen name="item/[id]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen
          name="item/edit"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen
          name="settings/server"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen
          name="settings/2fa"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceGrotesk_400Regular: require("../assets/fonts/SpaceGrotesk_400Regular.ttf"),
    SpaceGrotesk_500Medium: require("../assets/fonts/SpaceGrotesk_500Medium.ttf"),
    SpaceGrotesk_700Bold: require("../assets/fonts/SpaceGrotesk_700Bold.ttf"),
    InstrumentSerif_400Regular: require("../assets/fonts/InstrumentSerif_400Regular.ttf"),
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <VaultProvider>
        <AppThemeProvider>
          <ClockProvider>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </ClockProvider>
        </AppThemeProvider>
      </VaultProvider>
    </SafeAreaProvider>
  );
}
