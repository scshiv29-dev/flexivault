import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, Divider } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { IconTile } from "@/components/ui/IconTile";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Screen } from "@/components/ui/Screen";
import { useToast } from "@/components/ui/Toast";
import { serverHost } from "@/lib/format";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";

export default function ServerTwoFactorScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const {
    session,
    serverProfile,
    setupServerTotp,
    enableServerTotp,
    disableServerTotp,
  } = useVault();

  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(
    null
  );
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = Boolean(session?.totpEnabled ?? serverProfile?.totpEnabled);

  const begin = async () => {
    setStarting(true);
    setError(null);
    try {
      const challenge = await setupServerTotp();
      setSetup(challenge);
      setCode("");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enableServerTotp(code.trim());
      toast.show("Server two-factor enabled", "success");
      router.back();
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await disableServerTotp(code.trim());
      toast.show("Server two-factor disabled", "danger");
      router.back();
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      toast.show(`${label} copied`, "success");
    } catch {
      toast.show("Could not copy", "danger");
    }
  };

  return (
    <Screen keyboard bottomPadding={48}>
      <PageHeader
        eyebrow="Server security"
        title="Two-factor"
        subtitle={
          session
            ? `${serverHost(session.url)} · ${session.email}`
            : "Protect sign-in to your sync account."
        }
        onBack={() => router.back()}
      />

      {!session ? (
        <>
          <Callout
            tone="warning"
            title="No server connected"
            body="Server two-factor protects the account used to sync this vault. Connect a server first."
          />
          <Button
            label="Connect a server"
            icon="server"
            onPress={() => router.replace("/settings/server")}
            style={{ marginTop: 16 }}
          />
        </>
      ) : (
        <>
          <Card
            tone={enabled ? "accent" : "card"}
            style={{ padding: 15 }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 13 }}>
              <IconTile
                icon={enabled ? "shield" : "shield-off"}
                seed={enabled ? "enabled" : "disabled"}
                size={44}
                background={
                  enabled ? theme.colors.accentSoft : theme.colors.cardAlt
                }
                color={enabled ? theme.colors.accent : theme.colors.textMuted}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyStrong">
                  {enabled ? "Two-factor is on" : "Two-factor is off"}
                </AppText>
                <AppText variant="small" style={{ fontSize: 12 }}>
                  {enabled
                    ? "Sign-ins need a 6-digit code from your authenticator."
                    : "A stolen password alone cannot download your vault."}
                </AppText>
              </View>
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: enabled
                      ? theme.colors.accent
                      : theme.colors.cardStrong,
                  },
                ]}
              >
                <AppText
                  variant="caption"
                  style={{ fontSize: 9 }}
                  color={enabled ? theme.colors.accentInk : theme.colors.textMuted}
                >
                  {enabled ? "ON" : "OFF"}
                </AppText>
              </View>
            </View>
          </Card>

          {enabled ? (
            <>
              <SectionHeader title="Disable two-factor" />
              <Card style={{ padding: 15 }}>
                <AppText variant="small" style={{ fontSize: 13 }}>
                  Enter a current code from your authenticator to remove the
                  requirement from future server sign-ins.
                </AppText>
                <View style={{ marginTop: 14 }}>
                  <Field
                    label="AUTHENTICATOR CODE"
                    value={code}
                    onChangeText={(value) => {
                      setCode(value);
                      setError(null);
                    }}
                    placeholder="123 456"
                    icon="hash"
                    keyboardType="number-pad"
                    maxLength={6}
                    mono
                    autoFocus
                  />
                </View>
                {error ? (
                  <Callout tone="danger" body={error} style={{ marginTop: 12 }} />
                ) : null}
                <Button
                  label="Disable two-factor"
                  icon="shield-off"
                  variant="danger"
                  onPress={disable}
                  loading={busy}
                  disabled={code.trim().length !== 6}
                  style={{ marginTop: 14 }}
                />
              </Card>
              <Callout
                tone="warning"
                title="Keep a recovery path"
                body="If you lose the authenticator and two-factor stays enabled, you may be locked out of syncing this server account. Your local vault still unlocks with the master password."
                style={{ marginTop: 14 }}
              />
            </>
          ) : setup ? (
            <>
              <SectionHeader title="Finish setup" />
              <Card style={{ padding: 15 }}>
                <View style={styles.step}>
                  <View style={[styles.stepNumber, { backgroundColor: theme.colors.accent }]}>
                    <AppText
                      variant="caption"
                      style={{ color: theme.colors.accentInk, fontSize: 10 }}
                    >
                      1
                    </AppText>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
                      Add the key to your authenticator
                    </AppText>
                    <AppText variant="small" style={{ fontSize: 12 }}>
                      Choose “enter a setup key” and paste this secret. Time-based,
                      SHA-1, 6 digits, 30 seconds.
                    </AppText>
                  </View>
                </View>

                <Pressable
                  onPress={() => copy("Setup key", setup.secret)}
                  style={({ pressed }) => [
                    styles.secret,
                    {
                      backgroundColor: theme.colors.cardAlt,
                      borderColor: theme.colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Copy setup key"
                >
                  <AppText
                    style={{
                      fontFamily: theme.font.mono,
                      fontSize: 17,
                      lineHeight: 25,
                      letterSpacing: 1.6,
                      color: theme.colors.text,
                      flex: 1,
                    }}
                    selectable
                  >
                    {setup.secret.match(/.{1,4}/g)?.join(" ") ?? setup.secret}
                  </AppText>
                  <Feather name="copy" size={15} color={theme.colors.textMuted} />
                </Pressable>

                <Pressable
                  onPress={() => copy("otpauth link", setup.otpauthUrl)}
                  style={({ pressed }) => [
                    styles.linkRow,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Copy otpauth link"
                >
                  <Feather name="link" size={14} color={theme.colors.accent} />
                  <AppText variant="label" color={theme.colors.accent}>
                    Copy otpauth:// link
                  </AppText>
                </Pressable>

                <Divider style={{ marginVertical: 16 }} />

                <View style={styles.step}>
                  <View
                    style={[
                      styles.stepNumber,
                      { backgroundColor: theme.colors.cardStrong },
                    ]}
                  >
                    <AppText variant="caption" style={{ fontSize: 10 }}>
                      2
                    </AppText>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
                      Enter the code it generates
                    </AppText>
                    <AppText variant="small" style={{ fontSize: 12 }}>
                      This proves the authenticator has the right secret before we
                      switch two-factor on.
                    </AppText>
                  </View>
                </View>

                <View style={{ marginTop: 12 }}>
                  <Field
                    label="6-DIGIT CODE"
                    value={code}
                    onChangeText={(value) => {
                      setCode(value);
                      setError(null);
                    }}
                    placeholder="123 456"
                    icon="shield"
                    keyboardType="number-pad"
                    maxLength={6}
                    mono
                    autoFocus
                  />
                </View>

                {error ? (
                  <Callout tone="danger" body={error} style={{ marginTop: 12 }} />
                ) : null}

                <Button
                  label="Enable two-factor"
                  icon="check"
                  onPress={enable}
                  loading={busy}
                  disabled={code.trim().length !== 6}
                  style={{ marginTop: 14 }}
                />
                <Button
                  label="Start over"
                  variant="ghost"
                  onPress={begin}
                  disabled={starting}
                  style={{ marginTop: 4 }}
                />
              </Card>

              <Callout
                tone="info"
                title="Encrypted server-side"
                body="The server stores this TOTP secret encrypted with its own key, separate from your vault key. Your vault items remain end-to-end encrypted."
                style={{ marginTop: 14 }}
              />
            </>
          ) : (
            <>
              <SectionHeader title="How it fits together" />
              <Card style={{ paddingVertical: 2 }}>
                {[
                  [
                    "lock",
                    "Two layers",
                    "Vault contents are end-to-end encrypted. Server 2FA adds a second gate to account sign-in.",
                  ],
                  [
                    "smartphone",
                    "Standard TOTP",
                    "Works with any authenticator app — 6 digits, 30 seconds, SHA-1.",
                  ],
                  [
                    "key",
                    "No password change",
                    "Your master password is untouched. Only new server sign-ins need the code.",
                  ],
                ].map(([icon, title, body], index, list) => (
                  <View key={title}>
                    <View style={{ flexDirection: "row", gap: 12, padding: 13 }}>
                      <IconTile
                        icon={icon as "lock"}
                        seed={title}
                        size={34}
                        background={theme.colors.accentFaint}
                        color={theme.colors.accent}
                      />
                      <View style={{ flex: 1, gap: 1 }}>
                        <AppText variant="bodyStrong" style={{ fontSize: 13.5 }}>
                          {title}
                        </AppText>
                        <AppText variant="small" style={{ fontSize: 12 }}>
                          {body}
                        </AppText>
                      </View>
                    </View>
                    {index < list.length - 1 ? (
                      <Divider style={{ marginLeft: 59 }} />
                    ) : null}
                  </View>
                ))}
              </Card>

              {error ? (
                <Callout tone="danger" body={error} style={{ marginTop: 14 }} />
              ) : null}

              <Button
                label="Set up two-factor"
                icon="shield"
                onPress={begin}
                loading={starting}
                style={{ marginTop: 18 }}
              />
            </>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  step: {
    flexDirection: "row",
    gap: 10,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  secret: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 13,
    borderWidth: 1,
    marginTop: 12,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    marginTop: 2,
  },
});
