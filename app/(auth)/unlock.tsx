import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Platform, View } from "react-native";

import { AuthShell } from "@/components/auth/AuthShell";
import { AppText } from "@/components/ui/AppText";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";

function serverHost(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function UnlockScreen() {
  const theme = useAppTheme();
  const toast = useToast();
  const {
    unlock,
    unlockWithBiometrics,
    lock,
    settings,
    biometricAvailable,
    session,
    resetVault,
  } = useVault();

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);

  const submit = async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      await unlock(password);
      toast.show("Vault unlocked", "success");
    } catch (caught) {
      setError((caught as Error).message);
      setPassword("");
      setLoading(false);
    }
  };

  const biometric = async () => {
    setBioLoading(true);
    setError(null);
    try {
      await unlockWithBiometrics();
      toast.show("Welcome back", "success");
    } catch (caught) {
      const message = (caught as Error).message;
      if (!/cancel/i.test(message)) setError(message);
      setBioLoading(false);
    }
  };

  const reset = async () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    await resetVault();
    setHelpOpen(false);
    setResetArmed(false);
  };

  const showBiometrics =
    biometricAvailable && settings.biometricsEnabled && Platform.OS !== "web";

  return (
    <AuthShell
      footer={
        <AppText
          variant="small"
          align="center"
          style={{ fontSize: 11, opacity: 0.85 }}
        >
          AES-256-GCM · PBKDF2 · keys stay on this device
        </AppText>
      }
    >
      <View style={{ alignItems: "center", marginTop: 8 }}>
        <BrandMark size={58} />
        <AppText variant="display" style={{ fontSize: 43, marginTop: 18 }}>
          Welcome back.
        </AppText>
        <AppText
          variant="small"
          align="center"
          style={{ marginTop: 7, maxWidth: 300 }}
        >
          {session?.email
            ? `Unlock the vault for ${session.email}`
            : "Unlock your vault to pick up where you left off."}
        </AppText>
        {session ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginTop: 12,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 999,
              backgroundColor: theme.colors.cardAlt,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <View
              style={{
                width: 5,
                height: 5,
                borderRadius: 3,
                backgroundColor: theme.colors.accent,
              }}
            />
            <AppText variant="small" style={{ fontSize: 11 }}>
              {serverHost(session.url)} · sync on
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={{ marginTop: 30, gap: 14 }}>
        <Field
          label="MASTER PASSWORD"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setError(null);
          }}
          placeholder="Enter your master password"
          secure
          autoFocus={!showBiometrics}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          error={error}
        />

        <Button
          label="Unlock vault"
          icon="unlock"
          onPress={submit}
          loading={loading}
          disabled={!password}
        />

        {showBiometrics ? (
          <Button
            label="Use Face ID / fingerprint"
            variant="secondary"
            icon="smile"
            onPress={biometric}
            loading={bioLoading}
          />
        ) : null}
      </View>

      <View style={{ alignItems: "center", marginTop: 18 }}>
        <AppText
          variant="bodyStrong"
          color={theme.colors.textMuted}
          onPress={() => setHelpOpen(true)}
          accessibilityRole="button"
          style={{ fontSize: 13 }}
        >
          Forgot your master password?
        </AppText>
      </View>

      <Sheet
        visible={helpOpen}
        onClose={() => {
          setHelpOpen(false);
          setResetArmed(false);
        }}
        title="No recovery, by design"
        subtitle="The vault is encrypted with a key derived from your master password. Nobody can reset it for you."
      >
        <View style={{ gap: 14 }}>
          <Callout
            tone="info"
            title="If you sync to a server"
            body="Sign in on another device with the same master password to get your items back. The server only stores ciphertext."
          />
          <Callout
            tone="danger"
            title="If the password is gone"
            body="The only option is to erase this device's vault and start over. Server copies remain encrypted and unreadable without the password."
          />
          <Button
            label={
              resetArmed
                ? "Tap again to erase this device"
                : "Reset this device"
            }
            variant={resetArmed ? "danger" : "secondary"}
            icon="trash-2"
            onPress={async () => {
              if (!resetArmed) {
                setResetArmed(true);
                return;
              }
              if (Platform.OS === "web") {
                await reset();
                return;
              }
              Alert.alert(
                "Erase this vault?",
                "All items on this device will be permanently deleted. Synced copies on your server are not affected.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Erase",
                    style: "destructive",
                    onPress: async () => {
                      await reset();
                      toast.show("Device vault erased", "danger");
                    },
                  },
                ]
              );
            }}
          />
          {Platform.OS !== "web" ? (
            <Button
              label="Lock again"
              variant="ghost"
              icon="lock"
              onPress={() => {
                lock();
                setHelpOpen(false);
              }}
            />
          ) : null}
        </View>
      </Sheet>
    </AuthShell>
  );
}
