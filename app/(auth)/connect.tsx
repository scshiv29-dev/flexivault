import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Keyboard, View } from "react-native";

import { AuthShell } from "@/components/auth/AuthShell";
import { AppText } from "@/components/ui/AppText";
import { Button, LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { hasNativeQrScanner, scanConnectCode } from "@/lib/native/qr-scanner";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { ApiError, api, normalizeServerUrl } from "@/lib/vault/api";

export default function ConnectScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const { connectServer } = useVault();
  // Pre-filled when opened from a flexivault://connect link.
  const params = useLocalSearchParams<{ server?: string; email?: string }>();
  const scannerAvailable = hasNativeQrScanner();

  const [serverUrl, setServerUrl] = useState(typeof params.server === "string" ? params.server : "");
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [serverName, setServerName] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [scanning, setScanning] = useState(false);

  const scan = async () => {
    Keyboard.dismiss();
    setScanning(true);
    setError(null);
    try {
      const link = await scanConnectCode();
      if (!link) return;
      setServerUrl(link.server);
      if (link.email) setEmail(link.email);
      setServerName(null);
      setNotFound(false);
      toast.show(
        link.email ? "Server and email filled in" : "Server address filled in",
        "success"
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const test = async () => {
    if (!serverUrl) return;
    Keyboard.dismiss();
    setTesting(true);
    setError(null);
    try {
      const info = await api.serverInfo(normalizeServerUrl(serverUrl));
      setServerName(info.name);
      toast.show(`Connected to ${info.name}`, "success");
    } catch (caught) {
      setServerName(null);
      setError((caught as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const submit = async () => {
    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      await connectServer({
        url: serverUrl,
        email,
        password,
        totpCode: totpCode || undefined,
        fresh: true,
      });
      toast.show("Vault downloaded and unlocked", "success");
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === "totp_required" || caught.code === "invalid_totp") {
          setNeedsTotp(true);
        }
        setError(caught.message);
      } else if ((caught as { code?: string }).code === "account_not_found") {
        setNotFound(true);
        setError(
          "No account for this email on that server yet. Create a vault on this phone first, then join the server from Settings → Server."
        );
      } else {
        setError((caught as Error).message);
      }
      setLoading(false);
    }
  };

  return (
    <AuthShell back keyboard>
      <AppText variant="display" style={{ fontSize: 42, lineHeight: 44 }}>
        Connect your{"\n"}vault.
      </AppText>
      <AppText variant="small" style={{ marginTop: 12, maxWidth: 330 }}>
        Sign in to a FlexiVault server to pull down the encrypted vault you already
        own. The master password unlocks it locally.
      </AppText>

      {scannerAvailable ? (
        <Button
          label="Scan QR code"
          icon="maximize"
          variant="soft"
          onPress={scan}
          loading={scanning}
          style={{ marginTop: 20 }}
        />
      ) : null}

      <View style={{ marginTop: scannerAvailable ? 18 : 24, gap: 16 }}>
        <Field
          label="SERVER URL"
          value={serverUrl}
          onChangeText={(value) => {
            setServerUrl(value);
            setServerName(null);
            setError(null);
          }}
          placeholder="https://vault.example.com"
          icon="server"
          keyboardType="url"
          autoComplete="url"
          autoCapitalize="none"
          right={
            <AppText
              variant="label"
              color={theme.colors.accent}
              onPress={test}
              style={{ opacity: testing ? 0.5 : 1 }}
            >
              {testing ? "Testing…" : "Test"}
            </AppText>
          }
          hint={
            serverName
              ? `Reached ${serverName}. Ready when you are.`
              : scannerAvailable
                ? "Or scan the QR code on your server's /connect page."
                : "http:// is assumed for local addresses."
          }
        />

        <Field
          label="EMAIL"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setError(null);
          }}
          placeholder="you@example.com"
          icon="mail"
          keyboardType="email-address"
          autoComplete="email"
          autoCapitalize="none"
        />

        <Field
          label="MASTER PASSWORD"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setError(null);
          }}
          placeholder="The password that encrypts your vault"
          secure
          autoComplete="current-password"
          textContentType="password"
          returnKeyType={needsTotp ? "next" : "go"}
          onSubmitEditing={needsTotp ? undefined : submit}
        />

        {needsTotp ? (
          <Field
            label="TWO-FACTOR CODE"
            value={totpCode}
            onChangeText={setTotpCode}
            placeholder="6-digit code"
            icon="hash"
            keyboardType="number-pad"
            maxLength={6}
            mono
            returnKeyType="go"
            onSubmitEditing={submit}
            autoFocus
          />
        ) : null}
      </View>

      {error ? (
        <Callout tone={notFound ? "warning" : "danger"} body={error} style={{ marginTop: 16 }} />
      ) : (
        <Callout
          tone="info"
          title="Zero-knowledge sync"
          body="Your password is stretched on-device. The server receives only a verifier and opaque AES-GCM blobs."
          style={{ marginTop: 16 }}
        />
      )}

      <View style={{ marginTop: 22, gap: 10 }}>
        <Button
          label="Sign in and sync"
          icon="download-cloud"
          onPress={submit}
          loading={loading}
          disabled={!serverUrl || !email || !password}
        />
        <Button
          label="Create a local vault instead"
          variant="ghost"
          onPress={() => router.replace("/(auth)/create-vault")}
        />
      </View>

      <View style={{ marginTop: 16, alignItems: "center" }}>
        <LinkButton
          label="Need to run your own server?"
          onPress={() => {
            toast.show("See server/README.md for one-command hosting", "default");
          }}
        />
      </View>
    </AuthShell>
  );
}
