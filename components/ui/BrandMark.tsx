import { View } from "react-native";

import { useAppTheme } from "@/lib/theme";

/**
 * The FlexiVault mark: a rounded vault door with an off-centre dial and
 * a single cut-out notch. Deliberately geometric so it reads at 20px.
 */
export function BrandMark({
  size = 40,
  inverted = false,
}: {
  size?: number;
  inverted?: boolean;
}) {
  const theme = useAppTheme();
  const background = inverted ? theme.colors.accentInk : theme.colors.accent;
  const foreground = inverted ? theme.colors.accent : theme.colors.accentInk;

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.31,
        backgroundColor: background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: size * 0.56,
          height: size * 0.56,
          borderRadius: size * 0.28,
          borderWidth: Math.max(1.5, size * 0.075),
          borderColor: foreground,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.15,
          height: size * 0.15,
          borderRadius: size,
          backgroundColor: foreground,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.075,
          height: size * 0.22,
          borderRadius: size,
          backgroundColor: foreground,
          bottom: size * 0.2,
        }}
      />
    </View>
  );
}
