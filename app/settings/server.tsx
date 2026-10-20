import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Keyboard, Pressable, View } from "react-native";

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
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { ApiError, api, normalizeServerUrl, type ServerInfo } from "@/lib/vault/api";

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === code);
}

export default function ServerSettingsScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const {
    session,
    serverProfile,
    lastSyncedAt,
    syncStatus,
    connectServer,
    disconnectServer,
    syncNow,
    refreshServerProfile,
  } = useVault();

  const [url, setUrl] = useState(session?.url ?? "");
  const [email, setEmail] = useState(session?.email ?? "");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [saltMismatch, setSaltMismatch] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceArmed, setReplaceArmed] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const resetMessages = () => {
    setError(null);
    setSaltMismatch(false);
  };

  const test = async () => {
    if (!url.trim()) return;
    Keyboard.dismiss();
    setTesting(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.serverInfo(normalizeServerUrl(url));
      setInfo(result);
      if (!result.registrationOpen) {
        toast.show("Server found — registration is closed", "default");
      } else {
        toast.show(`Connected to ${result.name}`, "success");
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const submit = async (replaceLocal = false) => {
    Keyboard.dismiss();
    setBusy(true);
    resetMessages();

    if (replaceLocal) setReplaceArmed(false);

    try {
      const result = await connectServer({
        url,
        email,
        password,
        totpCode: totpCode.trim() || undefined,
        createIfMissing: !session && !replaceLocal,
        replaceLocal,
      });

      setReplaceOpen(false);
      toast.show(
        result.mode === "created"
          ? "Account created and vault uploaded"
          : result.mode === "replaced"
            ? "Device vault replaced with server copy"
            : "Server connected",
        "success"
      );
      router.back();
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === "totp_required" || caught.code === "invalid_totp") {
          setNeedsTotp(true);
        }
        setError(caught.message);
      } else if (isErrorCode(caught, "salt_mismatch")) {
        setSaltMismatch(true);
        setError((caught as Error).message);
      } else {
        setError((caught as Error).message);
      }
      setBusy(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
      await refreshServerProfile().catch(() => {});
      toast.show("Vault synced", "success");
    } catch (caught) {
      toast.show((caught as Error).message, "danger");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Screen keyboard bottomPadding={48}>
      <PageHeader
        eyebrow="Sync"
        title={session ? "Server connection" : "Connect a server"}
        subtitle={
          session
            ? "Reconnect, switch accounts, or manage this device's copy."
            : "Add end-to-end encrypted sync without changing your master password."
        }
        onBack={() => router.back()}
      />

      {session ? (
        <>
          <Card tone="accent" style={{ padding: 15 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <IconTile
                icon="cloud"
                seed={session.url}
                size={44}
                background={theme.colors.accentSoft}
                color={theme.colors.accent}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {serverHost(session.url)}
                  </AppText>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: theme.colors.accent,
                    }}
                  />
                </View>
                <AppText variant="small" numberOfLines={1} style={{ fontSize: 12 }}>
                  {session.email}
                </AppText>
              </View>
              <Feather name="check-circle" size={18} color={theme.colors.accent} />
            </View>

            <View
              style={{
                flexDirection: "row",
                gap: 18,
                marginTop: 15,
                paddingTop: 13,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <View style={{ flex: 1, gap: 1 }}>
                <AppText variant="caption" style={{ fontSize: 9.5 }}>
                  Revision
                </AppText>
                <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
                  {serverProfile?.revision ?? session.revision}
                </AppText>
              </View>
              <View style={{ flex: 1, gap: 1 }}>
                <AppText variant="caption" style={{ fontSize: 9.5 }}>
                  Server 2FA
                </AppText>
                <AppText
                  variant="bodyStrong"
                  style={{ fontSize: 14 }}
                  color={session.totpEnabled ? theme.colors.accent : undefined}
                >
                  {session.totpEnabled ? "Enabled" : "Off"}
                </AppText>
              </View>
              <View style={{ flex: 1.4, gap: 1 }}>
                <AppText variant="caption" style={{ fontSize: 9.5 }}>
                  Last sync
                </AppText>
                <AppText variant="bodyStrong" style={{ fontSize: 14 }} numberOfLines={1}>
                  {lastSyncedAt ? relativeTime(lastSyncedAt) : "Never"}
                </AppText>
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 15 }}>
              <Button
                label={syncing || syncStatus === "syncing" ? "Syncing…" : "Sync now"}
                icon="refresh-cw"
                variant="soft"
                size="sm"
                fullWidth={false}
                loading={syncing}
                onPress={runSync}
                style={{ flex: 1 }}
              />
              <Button
                label="Disconnect"
                icon="cloud-off"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={() => setDisconnectOpen(true)}
                style={{ flex: 1 }}
              />
            </View>
          </Card>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Button
              label="Server two-factor"
              icon="shield"
              variant="secondary"
              size="sm"
              fullWidth={false}
              onPress={() => router.push("/settings/2fa")}
              style={{ flex: 1 }}
            />
          </View>
        </>
      ) : (
        <Callout
          tone="info"
          title="Local-only right now"
          body="Your vault is encrypted on this device. Connecting uploads ciphertext only — the server never sees your master password or item contents."
        />
      )}

      <SectionHeader title={session ? "Use another account" : "Server details"} />

      <View style={{ gap: 16 }}>
        <Field
          label="SERVER URL"
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            setInfo(null);
            resetMessages();
          }}
          placeholder="https://vault.example.com"
          icon="server"
          keyboardType="url"
          autoComplete="url"
          right={
            <Pressable
              onPress={test}
              disabled={!url.trim() || testing}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Test server"
            >
              <AppText
                variant="label"
                color={theme.colors.accent}
                style={{ opacity: !url.trim() || testing ? 0.5 : 1 }}
              >
                {testing ? "Testing…" : "Test"}
              </AppText>
            </Pressable>
          }
          hint={
            info
              ? `${info.name} · v${info.version} · registration ${
                  info.registrationOpen ? "open" : "closed"
                }`
              : "http:// is assumed for local addresses."
          }
        />

        <Field
          label="EMAIL"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            resetMessages();
          }}
          placeholder="you@example.com"
          icon="mail"
          keyboardType="email-address"
          autoComplete="email"
        />

        <Field
          label="MASTER PASSWORD"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            resetMessages();
          }}
          placeholder={
            session
              ? "Confirm the password for this vault"
              : "The password that encrypts your vault"
          }
          secure
          autoComplete="current-password"
          textContentType="password"
          returnKeyType={needsTotp ? "next" : "go"}
          onSubmitEditing={needsTotp ? undefined : () => submit()}
          hint={
            session
              ? "Used on-device to derive the login verifier and unlock the server copy."
              : "If the server has no account for this email, one is created with this vault's password."
          }
        />

        {needsTotp ? (
          <Field
            label="SERVER TWO-FACTOR CODE"
            value={totpCode}
            onChangeText={(value) => {
              setTotpCode(value);
              setError(null);
            }}
            placeholder="6-digit code"
            icon="shield"
            keyboardType="number-pad"
            maxLength={6}
            mono
            autoFocus
            returnKeyType="go"
            onSubmitEditing={() => submit()}
          />
        ) : null}
      </View>

      {error ? (
        <Callout
          tone={saltMismatch ? "warning" : "danger"}
          title={saltMismatch ? "Different vault on the server" : undefined}
          body={error}
          style={{ marginTop: 16 }}
        />
      ) : null}

      {saltMismatch ? (
        <Card tone="alt" style={{ marginTop: 10, padding: 14 }}>
          <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
            Replace this device&apos;s vault?
          </AppText>
          <AppText variant="small" style={{ marginTop: 3 }}>
            The server copy was encrypted with a different master password. Replacing
            downloads that vault and discards this device&apos;s local items.
          </AppText>
          <Button
            label="Review replacement"
            variant="danger"
            icon="alert-triangle"
            size="sm"
            onPress={() => {
              setReplaceArmed(false);
              setReplaceOpen(true);
            }}
            style={{ marginTop: 12 }}
          />
        </Card>
      ) : null}

      <View style={{ marginTop: 22, gap: 10 }}>
        <Button
          label={
            session
              ? "Reconnect and sync"
              : info && !info.registrationOpen
                ? "Sign in to server"
                : "Connect and sync"
          }
          icon="cloud"
          onPress={() => submit()}
          loading={busy}
          disabled={!url.trim() || !email.trim() || !password}
        />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>

      <SectionHeader title="How sync works" />
      <Card style={{ paddingVertical: 2 }}>
        {[
          ["lock", "Zero-knowledge", "The server stores verifiers and ciphertext only."],
          ["git-merge", "Revision based", "Writes carry the last seen revision to avoid clobbering."],
          ["clock", "Merge by time", "Items resolve by updatedAt, deletions sync as tombstones."],
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
            {index < list.length - 1 ? <Divider style={{ marginLeft: 59 }} /> : null}
          </View>
        ))}
      </Card>

      <Sheet
        visible={replaceOpen}
        onClose={() => {
          setReplaceOpen(false);
          setReplaceArmed(false);
        }}
        title="Replace this device's vault?"
        subtitle="This downloads the server vault and erases the local copy on this device."
        footer={
          <>
            <Button
              label={
                replaceArmed
                  ? "Replace and download now"
                  : "I understand, continue"
              }
              variant="danger"
              icon="download"
              loading={busy}
              onPress={() => {
                if (!replaceArmed) {
                  setReplaceArmed(true);
                  return;
                }
                submit(true);
              }}
            />
            <Button
              label="Keep local vault"
              variant="ghost"
              onPress={() => {
                setReplaceOpen(false);
                setReplaceArmed(false);
              }}
            />
          </>
        }
      >
        <View style={{ gap: 12 }}>
          <Callout
            tone="danger"
            title="Local items will be discarded"
            body="Anything that exists only on this device will be gone. If it is already synced to another account, it stays there."
          />
          {replaceArmed ? (
            <Callout
              tone="warning"
              title="Second confirmation"
              body="Tap the red button again to replace the local encrypted vault."
            />
          ) : null}
        </View>
      </Sheet>

      <Sheet
        visible={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        title="Disconnect this server?"
        subtitle="The encrypted vault stays on this device. Nothing is deleted remotely."
        footer={
          <>
            <Button
              label="Disconnect"
              variant="danger"
              icon="cloud-off"
              onPress={async () => {
                await disconnectServer();
                setDisconnectOpen(false);
                setPassword("");
                toast.show("Server disconnected");
                router.back();
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
          body="Automatic sync stops immediately. You can reconnect later with the same account and master password."
        />
      </Sheet>
    </Screen>
  );
}
