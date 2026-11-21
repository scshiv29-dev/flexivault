import { useMemo } from "react";
import { View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { encodeQr } from "@/lib/qr/encode";

/**
 * Renders `value` as a QR code. Always dark-on-white with a quiet zone, even
 * in dark mode, because many scanners fail on inverted codes.
 */
export function QrCode({ value, size = 240 }: { value: string; size?: number }) {
  const { path, count } = useMemo(() => {
    const modules = encodeQr(value);
    let d = "";
    modules.forEach((row, y) =>
      row.forEach((on, x) => {
        if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      })
    );
    return { path: d, count: modules.length + 8 };
  }, [value]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="QR code"
      style={{ width: size, height: size, borderRadius: 12, overflow: "hidden" }}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`}>
        <Rect width={count} height={count} fill="#ffffff" />
        <Path d={path} fill="#000000" />
      </Svg>
    </View>
  );
}
