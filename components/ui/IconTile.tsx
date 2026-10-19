import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { View } from "react-native";

import { useAppTheme } from "@/lib/theme";

type FeatherName = ComponentProps<typeof Feather>["name"];

const LIGHT_PALETTE = [
  { bg: "#DDF6EC", fg: "#0B8563" },
  { bg: "#E5E9FC", fg: "#3E4DB3" },
  { bg: "#FCEBDD", fg: "#A85A19" },
  { bg: "#FBE2EA", fg: "#B0325B" },
  { bg: "#E1EFFC", fg: "#2668A7" },
  { bg: "#F1E6FD", fg: "#6F3FB5" },
  { bg: "#FBF4D4", fg: "#8A6C0C" },
  { bg: "#E3F4F8", fg: "#1F7486" },
];

const DARK_PALETTE = [
  { bg: "rgba(63, 224, 176, 0.13)", fg: "#5FE9C1" },
  { bg: "rgba(131, 169, 255, 0.14)", fg: "#9DBAFF" },
  { bg: "rgba(240, 180, 90, 0.14)", fg: "#F3C57F" },
  { bg: "rgba(255, 125, 125, 0.13)", fg: "#FF9B9B" },
  { bg: "rgba(94, 200, 214, 0.14)", fg: "#8ADCE7" },
  { bg: "rgba(196, 154, 255, 0.14)", fg: "#CBA6FF" },
  { bg: "rgba(214, 199, 118, 0.14)", fg: "#DED08A" },
  { bg: "rgba(125, 190, 255, 0.13)", fg: "#A2CEFF" },
];

function paletteIndex(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  }
  return Math.abs(hash) % LIGHT_PALETTE.length;
}

export function IconTile({
  icon,
  seed,
  size = 46,
  color,
  background,
}: {
  icon: FeatherName;
  seed: string;
  size?: number;
  color?: string;
  background?: string;
}) {
  const theme = useAppTheme();
  const index = paletteIndex(seed);
  const palette = theme.isDark ? DARK_PALETTE[index] : LIGHT_PALETTE[index];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: background ?? palette.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Feather
        name={icon}
        size={size * 0.44}
        color={color ?? palette.fg}
      />
    </View>
  );
}
