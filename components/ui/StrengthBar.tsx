import { View } from "react-native";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";

export function StrengthBar({
  score,
  fraction,
  label,
  showLabel = true,
}: {
  score: number;
  fraction: number;
  label?: string;
  showLabel?: boolean;
}) {
  const theme = useAppTheme();
  const palette =
    score >= 3
      ? theme.colors.accent
      : score >= 2
        ? theme.colors.warning
        : theme.colors.danger;

  return (
    <View>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              backgroundColor:
                index < Math.max(1, Math.round(fraction * 4))
                  ? palette
                  : theme.colors.cardStrong,
            }}
          />
        ))}
      </View>
      {showLabel ? (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginTop: 7,
          }}
        >
          <AppText variant="small" color={palette} style={{ fontSize: 12 }}>
            {label}
          </AppText>
          <AppText variant="small" style={{ fontSize: 12 }}>
            {Math.round(fraction * 100)}%
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
