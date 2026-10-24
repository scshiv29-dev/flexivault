import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import {
  AppState,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  View,
} from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, Divider } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { IconTile } from "@/components/ui/IconTile";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Screen } from "@/components/ui/Screen";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { relativeTime, serverHost } from "@/lib/format";
import {
  isAutofillAvailable,
  isAutofillEnabledOnDevice,
  openAutofillSettings,
} from "@/lib/native/autofill";
import {
  isPasskeyProviderAvailable,
  openPasskeySettings,
} from "@/lib/native/passkeys";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import type { ThemeMode } from "@/lib/vault/types";

type FeatherName = ComponentProps<typeof Feather>["name"];

function SettingRow({
  icon,
  title,
  subtitle,
  right,
  onPress,
  last = false,
  dangerous = false,
}: {
  icon: FeatherName;
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  dangerous?: boolean;
}) {
  const theme = useAppTheme();

  const body = (
    <View style={styles.rowInner}>
      <IconTile
        icon={icon}
        seed={title}
        size={36}
        background={dangerous ? theme.colors.dangerSoft : undefined}
        color={dangerous ? theme.colors.danger : undefined}
      />
      <View style={{ flex: 1, gap: 1 }}>
        <AppText
          variant="bodyStrong"
          style={{ fontSize: 14 }}
          color={dangerous ? theme.colors.danger : undefined}
        >
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="small" style={{ fontSize: 12 }}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right ??
        (onPress ? (
          <Feather
            name="chevron-right"
            size={17}
            color={theme.colors.textFaint}
          />
        ) : null)}
    </View>
  );

  if (!onPress) {
    return (
      <View>
        {body}
        {!last ? <Divider style={{ marginLeft: 60 }} /> : null}
      </View>
    );
  }

  return (
    <View>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1 }]}
      >
        {body}
      </Pressable>
      {!last ? <Divider style={{ marginLeft: 60 }} /> : null}
    </View>
  );
}

function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={{
        width: 46,
        height: 27,
        borderRadius: 14,
        padding: 3,
        backgroundColor: value ? theme.colors.accent : theme.colors.cardStrong,
        opacity: disabled ? 0.45 : 1,
        alignItems: value ? "flex-end" : "flex-start",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 21,
          height: 21,
          borderRadius: 11,
          backgroundColor: value ? theme.colors.accentInk : theme.colors.textFaint,
        }}
      />
    </Pressable>
  );
}

const AUTO_LOCK_OPTIONS = [
  { value: 1, label: "After 1 minute" },
  { value: 5, label: "After 5 minutes" },
  { value: 15, label: "After 15 minutes" },
  { value: 30, label: "After 30 minutes" },
  { value: 0, label: "Never" },
];

export default function SettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const {
    items,
    session,
    settings,
    syncStatus,
    syncError,
    lastSyncedAt,
    biometricAvailable,
    syncNow,
    disconnectServer,
    setAutoLockMinutes,
    setThemeMode,
    setAutofillEnabled,
    enableBiometrics,
    disableBiometrics,
    exportBackup,
    resetVault,
    lock,
  } = useVault();

  const [autoLockOpen, setAutoLockOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const [bioPassword, setBioPassword] = useState("");
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioBusy, setBioBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [autofillAvailable, setAutofillAvailable] = useState(false);
  const [autofillDeviceEnabled, setAutofillDeviceEnabled] = useState(false);
  const [autofillBusy, setAutofillBusy] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let cancelled = false;

    const refresh = () => {
      isAutofillAvailable().then((available) => {
        if (!cancelled) setAutofillAvailable(available);
      });
      isAutofillEnabledOnDevice().then((enabled) => {
        if (!cancelled) setAutofillDeviceEnabled(enabled);
      });
      isPasskeyProviderAvailable().then((available) => {
        if (!cancelled) setPasskeyAvailable(available);
      });
    };

    refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const autoLockLabel =
    settings.autoLockMinutes === 0
      ? "Never"
      : `After ${settings.autoLockMinutes} min`;

  const syncLabel =
    syncStatus === "syncing"
      ? "Syncing…"
      : syncStatus === "error"
        ? "Needs attention"
        : lastSyncedAt
          ? `Synced ${relativeTime(lastSyncedAt)}`
          : "Not synced yet";

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      toast.show("Vault synced", "success");
    } catch (caught) {
      toast.show((caught as Error).message, "danger");
    } finally {
      setSyncing(false);
    }
  };

  const toggleBiometrics = async (next: boolean) => {
    if (next) {
      if (!biometricAvailable) {
        toast.show(
          "Set up Face ID or a fingerprint in your device settings first.",
          "danger"
        );
        return;
      }
      setBioPassword("");
      setBioError(null);
      setBioOpen(true);
      return;
    }

    await disableBiometrics();
    toast.show("Biometric unlock disabled");
  };

  const submitBiometrics = async () => {
    setBioBusy(true);
    setBioError(null);
    try {
      await enableBiometrics(bioPassword);
      setBioOpen(false);
      toast.show("Biometric unlock enabled", "success");
    } catch (caught) {
      setBioError((caught as Error).message);
    } finally {
      setBioBusy(false);
    }
  };

  const toggleAutofill = async (next: boolean) => {
    setAutofillBusy(true);
    try {
      await setAutofillEnabled(next);
      if (next) {
        const enabled = await isAutofillEnabledOnDevice();
        setAutofillDeviceEnabled(enabled);
        toast.show(
          enabled
            ? "System autofill enabled"
            : "Autofill cache ready. Choose FlexiVault in Android settings.",
          "success"
        );
      } else {
        toast.show("System autofill disabled");
      }
    } catch (caught) {
      toast.show((caught as Error).message, "danger");
    } finally {
      setAutofillBusy(false);
    }
  };

  const openAndroidAutofill = async () => {
    try {
      await openAutofillSettings();
    } catch (caught) {
      toast.show((caught as Error).message, "danger");
    }
  };

  const openAndroidPasskeys = async () => {
    try {
      await openPasskeySettings();
    } catch (caught) {
      toast.show((caught as Error).message, "danger");
    }
  };

  const copyBackup = async () => {
    try {
      const backup = await exportBackup();
      await Clipboard.setStringAsync(backup);
      toast.show("Encrypted backup copied to clipboard", "success");
      if (Platform.OS !== "web" && backup.length < 40000) {
        await Share.share({
          message: backup,
          title: "FlexiVault encrypted backup",
        }).catch(() => {});
      }
    } catch (caught) {
      toast.show((caught as Error).message, "danger");
    }
  };

  const themes: Array<{ value: ThemeMode; label: string; icon: FeatherName }> = [
    { value: "system", label: "System", icon: "smartphone" },
    { value: "light", label: "Light", icon: "sun" },
    { value: "dark", label: "Dark", icon: "moon" },
  ];

  return (
    <Screen>
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        subtitle={`${items.length} items on this device`}
      />

      <SectionHeader title="Account & sync" />
      <Card style={{ paddingVertical: 2 }}>
        <View style={styles.serverHeader}>
          <IconTile
            icon={session ? "cloud" : "hard-drive"}
            seed={session?.url ?? "local"}
            size={46}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">
              {session ? serverHost(session.url) : "Local-only vault"}
            </AppText>
            <AppText variant="small" style={{ fontSize: 12 }}>
              {session ? session.email : "Nothing leaves this device"}
            </AppText>
            {session ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  marginTop: 3,
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor:
                      syncStatus === "error"
                        ? theme.colors.danger
                        : theme.colors.accent,
                  }}
                />
                <AppText variant="small" style={{ fontSize: 11 }}>
                  {syncLabel}
                </AppText>
              </View>
            ) : null}
          </View>
          {session ? (
            <Button
              label="Sync"
              variant="soft"
              size="sm"
              fullWidth={false}
              loading={syncing}
              onPress={runSync}
              icon="refresh-cw"
            />
          ) : (
            <Button
              label="Connect"
              variant="soft"
              size="sm"
              fullWidth={false}
              onPress={() => router.push("/settings/server")}
            />
          )}
        </View>

        {syncError ? (
          <Callout
            tone="danger"
            body={syncError}
            style={{ marginHorizontal: 13, marginBottom: 12 }}
          />
        ) : null}

        {session ? (
          <>
            <Divider style={{ marginLeft: 60 }} />
            <SettingRow
              icon="shield"
              title="Server two-factor"
              subtitle="Protect server sign-in with a TOTP code"
              right={
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <AppText
                    variant="label"
                    color={session.totpEnabled ? theme.colors.accent : theme.colors.textMuted}
                  >
                    {session.totpEnabled ? "On" : "Off"}
                  </AppText>
                  <Feather
                    name="chevron-right"
                    size={17}
                    color={theme.colors.textFaint}
                  />
                </View>
              }
              onPress={() => router.push("/settings/2fa")}
            />
            <SettingRow
              icon="settings"
              title="Manage server connection"
              subtitle={session.url}
              onPress={() => router.push("/settings/server")}
            />
            <SettingRow
              icon="cloud-off"
              title="Disconnect server"
              subtitle="Keep the encrypted vault on this device"
              onPress={() => setDisconnectOpen(true)}
              last
            />
          </>
        ) : (
          <>
            <Divider style={{ marginLeft: 60 }} />
            <SettingRow
              icon="server"
              title="Sync with a self-hosted server"
              subtitle="End-to-end encrypted, revision-based sync"
              onPress={() => router.push("/settings/server")}
              last
            />
          </>
        )}
      </Card>

      {!session ? (
        <Callout
          tone="info"
          title="Host it yourself"
          body="The FlexiVault server is one Node process with zero dependencies. Run it on a Pi, a VPS, or behind Tailscale."
          style={{ marginTop: 12 }}
        />
      ) : null}

      <SectionHeader title="Security" />
      <Card style={{ paddingVertical: 2 }}>
        <SettingRow
          icon="clock"
          title="Auto-lock"
          subtitle={autoLockLabel}
          onPress={() => setAutoLockOpen(true)}
        />
        {Platform.OS !== "web" ? (
          <SettingRow
            icon="smile"
            title="Biometric unlock"
            subtitle={
              biometricAvailable
                ? "Unlock with Face ID or fingerprint"
                : "No biometrics enrolled on this device"
            }
            right={
              <Toggle
                value={settings.biometricsEnabled}
                onChange={toggleBiometrics}
                disabled={!biometricAvailable}
              />
            }
          />
        ) : null}
        {Platform.OS === "android" ? (
          <>
            <SettingRow
              icon="smartphone"
              title="System autofill"
              subtitle={
                autofillAvailable
                  ? autofillDeviceEnabled
                    ? "Fill logins in apps and browsers after a device check"
                    : "Cache logins, then choose FlexiVault in Android settings"
                  : "Install the native Android build; Expo Go cannot provide autofill"
              }
              right={
                <Toggle
                  value={settings.autofillEnabled}
                  onChange={toggleAutofill}
                  disabled={!autofillAvailable || autofillBusy}
                />
              }
            />
            {autofillAvailable ? (
              <SettingRow
                icon="settings"
                title="Android autofill settings"
                subtitle={
                  autofillDeviceEnabled
                    ? "FlexiVault is the selected autofill service"
                    : "Choose FlexiVault as your autofill service"
                }
                onPress={openAndroidAutofill}
              />
            ) : null}
            <SettingRow
              icon="key"
              title="Android passkeys"
              subtitle={
                passkeyAvailable
                  ? "Create and use passkeys in apps and Chrome"
                  : "Requires Android 14 or newer"
              }
              onPress={passkeyAvailable ? openAndroidPasskeys : undefined}
            />
            {passkeyAvailable ? (
              <Callout
                tone="info"
                title="Passkeys stay in your encrypted vault"
                body="Choose FlexiVault as your passkey provider in Android settings. Creating or using a passkey asks for your fingerprint, face, or screen lock. Passkeys sync as encrypted vault items."
                style={{ marginTop: 10 }}
              />
            ) : null}
            {autofillAvailable && settings.autofillEnabled ? (
              <Callout
                tone={autofillDeviceEnabled ? "success" : "warning"}
                title={autofillDeviceEnabled ? "Autofill is ready" : "Finish autofill setup"}
                body={
                  autofillDeviceEnabled
                    ? "Android shows the biometric or screen-lock prompt over the app being filled, then fills the form. No overlay permission is needed. Native apps match by app name; add an Android package to a login for an exact match."
                    : "Choose FlexiVault in Android autofill settings. The device prompt appears over the app being filled, then fills the form. No overlay permission is needed."
                }
                style={{ marginTop: 10 }}
              />
            ) : null}
            {autofillAvailable && settings.autofillEnabled && autofillDeviceEnabled ? (
              <Callout
                tone="info"
                title="Using Chrome?"
                body="Open Chrome → Settings → Autofill and passwords → Autofill services and pick “Autofill using another service”. Restart Chrome after changing it. Other browsers use the Android picker directly."
                style={{ marginTop: 10 }}
              />
            ) : null}
          </>
        ) : null}
        <SettingRow
          icon="key"
          title="Master password"
          subtitle="No recovery by design · PBKDF2 210,000 rounds"
        />
        <SettingRow
          icon="lock"
          title="Lock now"
          onPress={() => {
            lock();
            toast.show("Vault locked");
          }}
          last
        />
      </Card>

      <SectionHeader title="Appearance" />
      <Card style={{ padding: 12 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {themes.map((option) => {
            const active = settings.themeMode === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setThemeMode(option.value)}
                style={({ pressed }) => [
                  styles.themeOption,
                  {
                    backgroundColor: active
                      ? theme.colors.accentSoft
                      : theme.colors.cardAlt,
                    borderColor: active ? theme.colors.accent : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather
                  name={themeOptionIcon(option.icon)}
                  size={16}
                  color={active ? theme.colors.accent : theme.colors.textMuted}
                />
                <AppText
                  variant="label"
                  color={active ? theme.colors.accent : theme.colors.textMuted}
                >
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <SectionHeader title="Vault data" />
      <Card style={{ paddingVertical: 2 }}>
        <SettingRow
          icon="upload-cloud"
          title="Import passwords"
          subtitle="CSV or JSON from another password manager"
          onPress={() => router.push("/import")}
        />
        <SettingRow
          icon="folder"
          title="Groups"
          subtitle="Organize items into encrypted folders"
          onPress={() => router.push("/groups")}
        />
        <SettingRow
          icon="download"
          title="Copy encrypted backup"
          subtitle="JSON of ciphertext, KDF salt and iterations"
          onPress={copyBackup}
        />
        <SettingRow
          icon="terminal"
          title="Self-host command"
          subtitle="docker compose up -d"
          onPress={async () => {
            await Clipboard.setStringAsync("docker compose up -d");
            toast.show("Command copied", "success");
          }}
        />
        <SettingRow
          icon="trash-2"
          title="Reset this device"
          subtitle="Erase the local vault and all keys"
          onPress={() => {
            setResetArmed(false);
            setResetOpen(true);
          }}
          dangerous
          last
        />
      </Card>

      <SectionHeader title="About" />
      <Card style={{ paddingVertical: 2 }}>
        <SettingRow icon="shield" title="Encryption" right={<AppText variant="small">AES-256-GCM</AppText>} />
        <SettingRow icon="hash" title="Key derivation" right={<AppText variant="small">PBKDF2 · 210k</AppText>} />
        <SettingRow icon="cloud" title="Sync" right={<AppText variant="small">Self-hosted</AppText>} />
        <SettingRow icon="info" title="Version" right={<AppText variant="small">{Constants.expoConfig?.version ?? "1.0.4"}</AppText>} last />
      </Card>

      <AppText
        variant="small"
        align="center"
        style={{ marginTop: 20, fontSize: 11, opacity: 0.7 }}
      >
        FlexiVault · keys stay with you
      </AppText>

      {/* Auto-lock sheet */}
      <Sheet
        visible={autoLockOpen}
        onClose={() => setAutoLockOpen(false)}
        title="Auto-lock"
        subtitle="Lock the vault after the app has been in the background."
      >
        <View style={{ gap: 8 }}>
          {AUTO_LOCK_OPTIONS.map((option) => {
            const active = settings.autoLockMinutes === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={async () => {
                  await setAutoLockMinutes(option.value);
                  setAutoLockOpen(false);
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  {
                    backgroundColor: active
                      ? theme.colors.accentSoft
                      : theme.colors.card,
                    borderColor: active
                      ? theme.colors.accent
                      : theme.colors.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
                  {option.label}
                </AppText>
                {active ? (
                  <Feather name="check" size={17} color={theme.colors.accent} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Sheet>

      {/* Enable biometrics sheet */}
      <Sheet
        visible={bioOpen}
        onClose={() => setBioOpen(false)}
        title="Enable biometric unlock"
        subtitle="Confirm your master password. The derived key is stored in the device keychain."
        footer={
          <Button
            label="Enable Face ID / fingerprint"
            icon="smile"
            onPress={submitBiometrics}
            loading={bioBusy}
            disabled={!bioPassword}
          />
        }
      >
        <Field
          label="MASTER PASSWORD"
          value={bioPassword}
          onChangeText={(value) => {
            setBioPassword(value);
            setBioError(null);
          }}
          placeholder="Confirm your master password"
          secure
          autoFocus
          autoComplete="current-password"
          error={bioError}
          returnKeyType="done"
          onSubmitEditing={submitBiometrics}
        />
      </Sheet>

      {/* Disconnect sheet */}
      <Sheet
        visible={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect server?"
        subtitle="The local encrypted vault stays on this device. Nothing is deleted from your server."
        footer={
          <>
            <Button
              label="Disconnect"
              variant="danger"
              icon="cloud-off"
              onPress={async () => {
                await disconnectServer();
                setDisconnectOpen(false);
                toast.show("Server disconnected");
              }}
            />
            <Button
              label="Keep connected"
              variant="ghost"
              onPress={() => setDisconnectOpen(false)}
            />
          </>
        }
      >
        <Callout
          tone="warning"
          body="Automatic sync stops until you reconnect. Local edits remain on this device."
        />
      </Sheet>

      {/* Reset sheet */}
      <Sheet
        visible={resetOpen}
        onClose={() => {
          setResetOpen(false);
          setResetArmed(false);
        }}
        title="Reset this device?"
        subtitle="This permanently erases the local vault and its encryption keys."
        footer={
          <>
            <Button
              label={
                resetArmed ? "Erase everything on this device" : "Reset this device"
              }
              variant="danger"
              icon="trash-2"
              onPress={async () => {
                if (!resetArmed) {
                  setResetArmed(true);
                  return;
                }
                await resetVault();
                setResetOpen(false);
                toast.show("Device vault erased", "danger");
              }}
            />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => {
                setResetOpen(false);
                setResetArmed(false);
              }}
            />
          </>
        }
      >
        <View style={{ gap: 12 }}>
          <Callout
            tone="danger"
            title="This cannot be undone"
            body="There is no cloud copy we can restore. If you sync, the server copy stays encrypted and untouched."
          />
          {resetArmed ? (
            <Callout
              tone="warning"
              title="Tap once more to confirm"
              body={`${items.length} items will be deleted from this device.`}
            />
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

function themeOptionIcon(icon: FeatherName): FeatherName {
  return icon;
}

const styles = StyleSheet.create({
  serverHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
  },
  rowInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  themeOption: {
    flex: 1,
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 13,
    borderWidth: 1,
  },
});
