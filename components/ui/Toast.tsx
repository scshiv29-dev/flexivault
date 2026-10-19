import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "@/lib/theme";

type ToastTone = "default" | "success" | "danger";

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  show: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const theme = useAppTheme();
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(14)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(translate, {
        toValue: 10,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(() => setToast(null));
  }, [opacity, translate]);

  const show = useCallback(
    (message: string, tone: ToastTone = "default") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, tone });

      if (Platform.OS !== "web") {
        (tone === "danger"
          ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
          : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        ).catch(() => {});
      }

      opacity.setValue(0);
      translate.setValue(14);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(translate, {
          toValue: 0,
          useNativeDriver: true,
          speed: 18,
          bounciness: 6,
        }),
      ]).start();

      timer.current = setTimeout(hide, 2100);
    },
    [hide, opacity, translate]
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const icon =
    toast?.tone === "success"
      ? "check-circle"
      : toast?.tone === "danger"
        ? "alert-circle"
        : "check";

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.wrapper,
            { opacity, transform: [{ translateY: translate }] },
          ]}
        >
          <View
            style={[
              styles.toast,
              {
                backgroundColor: theme.colors.cardStrong,
                borderColor: theme.colors.borderStrong,
              },
              theme.shadow.floating,
            ]}
          >
            <Feather
              name={icon}
              size={16}
              color={
                toast.tone === "danger"
                  ? theme.colors.danger
                  : theme.colors.accent
              }
            />
            <Text
              style={{
                color: theme.colors.text,
                fontFamily: theme.font.medium,
                fontSize: 14,
                flexShrink: 1,
              }}
            >
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 104,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: "100%",
  },
});
