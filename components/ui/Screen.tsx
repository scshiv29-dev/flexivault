import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useEffect, useRef } from "react";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useAppTheme } from "@/lib/theme";

export function Screen({
  children,
  scroll = true,
  contentContainerStyle,
  style,
  edges = ["top"],
  bottomPadding = 120,
  keyboard = false,
  refreshControl,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  edges?: Edge[];
  bottomPadding?: number;
  keyboard?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const theme = useAppTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateY]);

  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[
        {
          paddingHorizontal: theme.spacing.xl,
          paddingBottom: bottomPadding,
        },
        contentContainerStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, contentContainerStyle]}>{children}</View>
  );

  const wrapped = keyboard ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
    >
      {content}
    </KeyboardAvoidingView>
  ) : (
    content
  );

  return (
    <SafeAreaView
      edges={edges}
      style={[
        styles.flex,
        { backgroundColor: theme.colors.background },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.flex,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        {wrapped}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
