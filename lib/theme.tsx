import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Platform, useColorScheme as useSystemColorScheme } from "react-native";

import { useVault } from "@/lib/state/vault-provider";

export interface ThemeColors {
  background: string;
  backgroundAlt: string;
  card: string;
  cardAlt: string;
  cardStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentInk: string;
  accentSoft: string;
  accentFaint: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  info: string;
  infoSoft: string;
  overlay: string;
  tabBar: string;
  skeleton: string;
  white: string;
  gradient: [string, string, string];
}

export interface AppTheme {
  mode: "light" | "dark";
  isDark: boolean;
  colors: ThemeColors;
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    xxxl: number;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    full: number;
  };
  font: {
    sans: string;
    medium: string;
    bold: string;
    display: string;
    mono: string;
  };
  shadow: {
    card: Record<string, unknown>;
    floating: Record<string, unknown>;
  };
  statusBar: "light-content" | "dark-content";
}

const lightColors: ThemeColors = {
  background: "#F6F8F4",
  backgroundAlt: "#EEF2EC",
  card: "#FFFFFF",
  cardAlt: "#F0F4EF",
  cardStrong: "#E5EBE4",
  text: "#0C1411",
  textMuted: "#5E6D67",
  textFaint: "#93A09B",
  border: "#E1E7DF",
  borderStrong: "#CBD6CE",
  accent: "#0E9F76",
  accentInk: "#FFFFFF",
  accentSoft: "#D9F5E9",
  accentFaint: "#ECFBF4",
  danger: "#CF3F3F",
  dangerSoft: "#FBE6E4",
  warning: "#A86A10",
  warningSoft: "#FCF0D7",
  success: "#0E9F76",
  successSoft: "#D9F5E9",
  info: "#2E64D8",
  infoSoft: "#E4EBFC",
  overlay: "rgba(8, 16, 12, 0.48)",
  tabBar: "rgba(255, 255, 255, 0.94)",
  skeleton: "#E4EAE2",
  white: "#FFFFFF",
  gradient: ["#E3FBF0", "#F6F8F4", "#F6F8F4"],
};

const darkColors: ThemeColors = {
  background: "#070C0A",
  backgroundAlt: "#0B1210",
  card: "#0F1714",
  cardAlt: "#15201C",
  cardStrong: "#1C2924",
  text: "#ECF5F0",
  textMuted: "#93A69E",
  textFaint: "#5E7169",
  border: "#1E2B26",
  borderStrong: "#2C3D36",
  accent: "#3FE0B0",
  accentInk: "#03231A",
  accentSoft: "#10342A",
  accentFaint: "#0C211B",
  danger: "#FF7D7D",
  dangerSoft: "#361B1B",
  warning: "#F0B45A",
  warningSoft: "#332711",
  success: "#3FE0B0",
  successSoft: "#10342A",
  info: "#83A9FF",
  infoSoft: "#17233F",
  overlay: "rgba(0, 0, 0, 0.62)",
  tabBar: "rgba(12, 19, 16, 0.95)",
  skeleton: "#1A2722",
  white: "#FFFFFF",
  gradient: ["#0D2A22", "#070C0A", "#070C0A"],
};

const themeBase = {
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 22,
    xxl: 32,
    xxxl: 44,
  },
  radius: {
    sm: 10,
    md: 14,
    lg: 20,
    xl: 26,
    xxl: 34,
    full: 999,
  },
  font: {
    sans: "SpaceGrotesk_400Regular",
    medium: "SpaceGrotesk_500Medium",
    bold: "SpaceGrotesk_700Bold",
    display: "InstrumentSerif_400Regular",
    mono: Platform.select({
      ios: "SpaceMono",
      android: "SpaceMono",
      default: "SpaceMono",
    }) as string,
  },
};

function buildTheme(isDark: boolean): AppTheme {
  const colors = isDark ? darkColors : lightColors;
  return {
    ...themeBase,
    mode: isDark ? "dark" : "light",
    isDark,
    colors,
    shadow: {
      card: isDark
        ? {
            shadowColor: "#000000",
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.35,
            shadowRadius: 20,
            elevation: 3,
          }
        : {
            shadowColor: "#244035",
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.07,
            shadowRadius: 24,
            elevation: 2,
          },
      floating: isDark
        ? {
            shadowColor: "#000000",
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.5,
            shadowRadius: 28,
            elevation: 8,
          }
        : {
            shadowColor: "#173D30",
            shadowOffset: { width: 0, height: 14 },
            shadowOpacity: 0.14,
            shadowRadius: 30,
            elevation: 8,
          },
    },
    statusBar: isDark ? "light-content" : "dark-content",
  };
}

const ThemeContext = createContext<AppTheme>(buildTheme(false));

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { settings } = useVault();
  const system = useSystemColorScheme();

  const theme = useMemo(() => {
    const resolved =
      settings.themeMode === "system"
        ? system === "dark"
          ? "dark"
          : "light"
        : settings.themeMode;
    return buildTheme(resolved === "dark");
  }, [settings.themeMode, system]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): AppTheme {
  return useContext(ThemeContext);
}
