import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";

export function ProgressRing({
  size = 120,
  stroke = 8,
  progress,
  color,
  trackColor,
  children,
  rotate = -90,
}: {
  size?: number;
  stroke?: number;
  progress: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
  rotate?: number;
}) {
  const theme = useAppTheme();
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor ?? theme.colors.cardStrong}
          strokeWidth={stroke}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color ?? theme.colors.accent}
          strokeWidth={stroke}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - clamped)}
          rotation={rotate}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {children}
    </View>
  );
}

export function SecurityScoreRing({
  score,
  size = 132,
  label,
}: {
  score: number;
  size?: number;
  label?: string;
}) {
  const theme = useAppTheme();
  const color =
    score >= 80
      ? theme.colors.accent
      : score >= 55
        ? theme.colors.warning
        : theme.colors.danger;

  return (
    <ProgressRing size={size} stroke={9} progress={score / 100} color={color}>
      <AppText
        style={{
          fontFamily: theme.font.display,
          fontSize: size * 0.34,
          lineHeight: size * 0.38,
          color: theme.colors.text,
        }}
      >
        {score}
      </AppText>
      {label ? (
        <AppText variant="caption" style={{ fontSize: 9 }}>
          {label}
        </AppText>
      ) : null}
    </ProgressRing>
  );
}
