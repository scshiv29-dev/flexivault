import { Feather } from "@expo/vector-icons";
import { useState, type ComponentProps, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useAppTheme } from "@/lib/theme";
import { AppText } from "./AppText";

type FeatherName = ComponentProps<typeof Feather>["name"];

export interface FieldProps {
  label?: string;
  value: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  error?: string | null;
  hint?: string | null;
  icon?: FeatherName;
  right?: ReactNode;
  multiline?: boolean;
  mono?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoComplete?: ComponentProps<typeof TextInput>["autoComplete"];
  keyboardType?: KeyboardTypeOptions;
  autoFocus?: boolean;
  editable?: boolean;
  maxLength?: number;
  returnKeyType?: ComponentProps<typeof TextInput>["returnKeyType"];
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  style?: StyleProp<ViewStyle>;
  inputStyle?: ComponentProps<typeof TextInput>["style"];
  textContentType?: ComponentProps<typeof TextInput>["textContentType"];
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure = false,
  error,
  hint,
  icon,
  right,
  multiline = false,
  mono = false,
  autoCapitalize = "none",
  autoComplete,
  keyboardType,
  autoFocus,
  editable = true,
  maxLength,
  returnKeyType,
  onSubmitEditing,
  onFocus,
  onBlur,
  style,
  inputStyle,
  textContentType,
}: FieldProps) {
  const theme = useAppTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const borderColor = error
    ? theme.colors.danger
    : focused
      ? theme.colors.accent
      : theme.colors.border;

  return (
    <View style={style}>
      {label ? (
        <AppText variant="label" style={styles.label}>
          {label}
        </AppText>
      ) : null}

      <View
        style={[
          styles.container,
          {
            backgroundColor: editable ? theme.colors.cardAlt : theme.colors.backgroundAlt,
            borderColor,
            borderRadius: theme.radius.md,
            minHeight: multiline ? 132 : 52,
            alignItems: multiline ? "flex-start" : "center",
          },
        ]}
      >
        {icon ? (
          <Feather
            name={icon}
            size={17}
            color={focused ? theme.colors.accent : theme.colors.textFaint}
            style={{ marginRight: 10, marginTop: multiline ? 16 : 0 }}
          />
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textFaint}
          secureTextEntry={secure && !revealed}
          multiline={multiline}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          keyboardType={keyboardType}
          autoFocus={autoFocus}
          editable={editable}
          maxLength={maxLength}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          textContentType={textContentType}
          selectionColor={theme.colors.accent}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          style={[
            styles.input,
            {
              color: theme.colors.text,
              fontFamily: mono ? theme.font.mono : theme.font.sans,
              textAlignVertical: multiline ? "top" : "center",
              paddingTop: multiline ? 14 : 0,
              minHeight: multiline ? 128 : 50,
            },
            inputStyle,
          ]}
        />

        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide value" : "Show value"}
            onPress={() => setRevealed((current) => !current)}
            hitSlop={10}
            style={styles.trailing}
          >
            <Feather
              name={revealed ? "eye-off" : "eye"}
              size={17}
              color={theme.colors.textFaint}
            />
          </Pressable>
        ) : null}

        {right ? <View style={styles.trailing}>{right}</View> : null}
      </View>

      {error ? (
        <AppText variant="small" color={theme.colors.danger} style={styles.message}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" style={styles.message}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: 7,
    marginLeft: 2,
  },
  container: {
    flexDirection: "row",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 0,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 14,
  },
  trailing: {
    paddingLeft: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    marginTop: 6,
    marginLeft: 2,
  },
});
