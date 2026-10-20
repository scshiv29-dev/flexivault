import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "@/components/ui/AppText";
import { BrandMark } from "@/components/ui/BrandMark";

export function AuthShell({
  children,
  footer,
  back,
  keyboard = true,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  back?: boolean;
  keyboard?: boolean;
}) {
  const theme = useAppTheme();
  const router = useRouter();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  const content = (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.topBar}>
        {back ? (
          <AppText
            variant="bodyStrong"
            color={theme.colors.textMuted}
            onPress={() => router.back()}
            accessibilityRole="button"
          >
            ← Back
          </AppText>
        ) : (
          <View style={styles.brandRow}>
            <BrandMark size={30} />
            <AppText variant="h3" style={{ letterSpacing: -0.2 }}>
              FlexiVault
            </AppText>
          </View>
        )}
        <View
          style={[
            styles.securePill,
            {
              backgroundColor: theme.colors.accentFaint,
              borderColor: theme.colors.border,
            },
          ]}
        >
          <View
            style={[styles.secureDot, { backgroundColor: theme.colors.accent }]}
          />
          <AppText variant="caption" color={theme.colors.accent} style={{ fontSize: 9 }}>
            Encrypted
          </AppText>
        </View>
      </View>

      {children}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </ScrollView>
  );

  return (
    <LinearGradient colors={theme.colors.gradient} style={styles.flex}>
      <View
        pointerEvents="none"
        style={[
          styles.orb,
          styles.orbTop,
          { backgroundColor: theme.colors.accent, opacity: theme.isDark ? 0.08 : 0.06 },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.orb,
          styles.orbBottom,
          { backgroundColor: theme.colors.info, opacity: theme.isDark ? 0.07 : 0.05 },
        ]}
      />
      <SafeAreaView style={styles.flex}>
        <Animated.View
          style={[
            styles.flex,
            { opacity, transform: [{ translateY }] },
          ]}
        >
          {keyboard ? (
            <KeyboardAvoidingView
              style={styles.flex}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
            >
              {content}
            </KeyboardAvoidingView>
          ) : (
            content
          )}
        </Animated.View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    flexGrow: 1,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 10,
    marginBottom: 42,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  securePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  secureDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  footer: {
    marginTop: "auto",
    paddingTop: 28,
  },
  orb: {
    position: "absolute",
    borderRadius: 999,
  },
  orbTop: {
    width: 320,
    height: 320,
    right: -130,
    top: -100,
  },
  orbBottom: {
    width: 280,
    height: 280,
    left: -140,
    bottom: 40,
  },
});
