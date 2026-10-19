import { Feather } from "@expo/vector-icons";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";

export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  scroll = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
      >
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close sheet"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.backgroundAlt,
              borderColor: theme.colors.border,
              paddingBottom: Math.max(insets.bottom, 18),
              maxHeight: "92%",
            },
          ]}
        >
          <View
            style={[styles.handle, { backgroundColor: theme.colors.borderStrong }]}
          />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              {title ? <AppText variant="h2">{title}</AppText> : null}
              {subtitle ? (
                <AppText variant="small" style={{ marginTop: 4 }}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              style={[
                styles.close,
                { backgroundColor: theme.colors.cardAlt },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Feather name="x" size={18} color={theme.colors.text} />
            </Pressable>
          </View>

          {scroll ? (
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.scroll}
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              {children}
            </ScrollView>
          ) : (
            <View>{children}</View>
          )}

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 10,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    paddingTop: 12,
    gap: 10,
  },
  scroll: {
    flexShrink: 1,
  },
});
