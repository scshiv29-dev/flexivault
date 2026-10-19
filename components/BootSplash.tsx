import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./ui/AppText";
import { BrandMark } from "./ui/BrandMark";

export function BootSplash() {
  const theme = useAppTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 420,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        speed: 12,
        bounciness: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  return (
    <LinearGradient colors={theme.colors.gradient} style={styles.flex}>
      <SafeAreaView style={styles.content}>
        <Animated.View
          style={{ opacity, transform: [{ scale }], alignItems: "center" }}
        >
          <BrandMark size={74} />
          <AppText variant="display" style={{ marginTop: 20, fontSize: 40 }}>
            FlexiVault
          </AppText>
          <AppText variant="small" style={{ marginTop: 6 }}>
            Your passwords and codes, in one quiet place.
          </AppText>
        </Animated.View>
        <View style={styles.footer}>
          <View style={styles.dots}>
            {[0, 1, 2].map((index) => (
              <PulseDot key={index} delay={index * 160} color={theme.colors.accent} />
            ))}
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

function PulseDot({ delay, color }: { delay: number; color: string }) {
  const opacity = useRef(new Animated.Value(0.25)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 420,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 420,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [delay, opacity]);

  return (
    <Animated.View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: color,
        opacity,
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    position: "absolute",
    bottom: 54,
  },
  dots: {
    flexDirection: "row",
    gap: 7,
  },
});
