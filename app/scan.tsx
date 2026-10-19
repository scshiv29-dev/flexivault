import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button, LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { ChipRow } from "@/components/ui/ChipRow";
import { Field } from "@/components/ui/Field";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Screen } from "@/components/ui/Screen";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useVault } from "@/lib/state/vault-provider";
import type { NewVaultItem } from "@/lib/state/vault-helpers";
import { useAppTheme } from "@/lib/theme";
import {
  isMigrationUrl,
  isOtpAuthUrl,
  otpToTotpConfig,
  parseMigrationUrl,
  parseOtpAuthUrl,
  type ParsedOtpAuth,
} from "@/lib/vault/otpauth";
import {
  base32Decode,
  formatTotpCode,
  generateTotp,
  isValidBase32,
  normaliseBase32,
} from "@/lib/vault/otp";
import type { TotpAlgorithm } from "@/lib/vault/types";

type Mode = "camera" | "manual" | "paste";

function draftFromParsed(parsed: ParsedOtpAuth): NewVaultItem {
  const name =
    [parsed.issuer, parsed.label].filter(Boolean).join(" · ") || "Authenticator";
  return {
    type: "totp",
    name,
    username: parsed.label || undefined,
    urls: [],
    notes: "",
    favorite: false,
    totp: otpToTotpConfig(parsed),
  };
}

export default function ScanScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const { addItem, importItems } = useVault();
  const [permission, requestPermission] = useCameraPermissions();

  const [mode, setMode] = useState<Mode>("camera");
  const [scanning, setScanning] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedOtpAuth[] | null>(null);
  const [importing, setImporting] = useState(false);
  const lockRef = useRef(false);

  const [issuer, setIssuer] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [algorithm, setAlgorithm] = useState<TotpAlgorithm>("SHA1");
  const [digits, setDigits] = useState("6");
  const [period, setPeriod] = useState("30");
  const [manualError, setManualError] = useState<string | null>(null);

  const [pasteValue, setPasteValue] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const handlePayload = (data: string) => {
    if (lockRef.current) return;
    setParseError(null);

    try {
      if (isOtpAuthUrl(data)) {
        const single = parseOtpAuthUrl(data);
        lockRef.current = true;
        setScanning(false);
        setParsed([single]);
        return;
      }
      if (isMigrationUrl(data)) {
        const many = parseMigrationUrl(data);
        if (many.length === 0) {
          throw new Error("That migration code contained no TOTP accounts.");
        }
        lockRef.current = true;
        setScanning(false);
        setParsed(many);
        return;
      }
      throw new Error("That QR code is not an authenticator code.");
    } catch (caught) {
      setParseError((caught as Error).message);
      setScanning(false);
      setTimeout(() => setScanning(true), 1400);
    }
  };

  const closeSheet = () => {
    setParsed(null);
    lockRef.current = false;
    setScanning(true);
  };

  const confirmImport = async () => {
    if (!parsed || parsed.length === 0) return;
    setImporting(true);
    try {
      if (parsed.length === 1) {
        await addItem(draftFromParsed(parsed[0]));
        toast.show("Authenticator added", "success");
      } else {
        await importItems(parsed.map(draftFromParsed));
        toast.show(`${parsed.length} authenticators imported`, "success");
      }
      setParsed(null);
      router.back();
    } catch (caught) {
      setParseError((caught as Error).message);
      setImporting(false);
    }
  };

  const addManual = async () => {
    setManualError(null);
    const clean = normaliseBase32(secret);
    if (!clean) {
      setManualError("Paste the secret key from the service's 2FA setup.");
      return;
    }
    if (!isValidBase32(clean)) {
      setManualError("That key is not valid base32. Check for missing characters.");
      return;
    }
    try {
      base32Decode(clean);
    } catch {
      setManualError("That key could not be decoded.");
      return;
    }

    const parsedDigits = Number.parseInt(digits, 10);
    const parsedPeriod = Number.parseInt(period, 10);
    const safeDigits = parsedDigits === 8 ? 8 : parsedDigits === 7 ? 7 : 6;
    const safePeriod = Number.isFinite(parsedPeriod)
      ? Math.max(10, Math.min(300, parsedPeriod))
      : 30;

    setImporting(true);
    try {
      await addItem({
        type: "totp",
        name:
          [issuer.trim(), label.trim()].filter(Boolean).join(" · ") ||
          "Authenticator",
        username: label.trim() || undefined,
        urls: [],
        notes: "",
        favorite: false,
        totp: {
          secret: clean,
          algorithm,
          digits: safeDigits,
          period: safePeriod,
          issuer: issuer.trim() || undefined,
          label: label.trim() || undefined,
        },
      });
      toast.show("Authenticator added", "success");
      router.back();
    } catch (caught) {
      setManualError((caught as Error).message);
      setImporting(false);
    }
  };

  const parsePaste = () => {
    setPasteError(null);
    if (!pasteValue.trim()) return;
    try {
      if (isMigrationUrl(pasteValue)) {
        const many = parseMigrationUrl(pasteValue);
        if (many.length === 0) throw new Error("No TOTP accounts found.");
        setParsed(many);
        return;
      }
      if (isOtpAuthUrl(pasteValue)) {
        setParsed([parseOtpAuthUrl(pasteValue)]);
        return;
      }
      throw new Error("Paste an otpauth:// or otpauth-migration:// link.");
    } catch (caught) {
      setPasteError((caught as Error).message);
    }
  };

  const preview = (() => {
    try {
      const clean = normaliseBase32(secret);
      if (!isValidBase32(clean)) return null;
      return generateTotp({
        secret: clean,
        algorithm,
        digits: digits === "8" ? 8 : 6,
        period: 30,
      });
    } catch {
      return null;
    }
  })();

  return (
    <Screen bottomPadding={40}>
      <PageHeader
        eyebrow="Scan"
        title="Add a code"
        subtitle="Point at an otpauth QR code, or enter the secret by hand."
        onBack={() => router.back()}
      />

      <ChipRow
        options={[
          { key: "camera", label: "Scan QR", icon: "camera" },
          { key: "manual", label: "Enter key", icon: "edit-3" },
          { key: "paste", label: "Paste link", icon: "clipboard" },
        ]}
        value={mode}
        onChange={(value) => {
          setMode(value as Mode);
          setParseError(null);
          lockRef.current = false;
          setScanning(true);
        }}
      />

      {mode === "camera" ? (
        <View style={{ marginTop: 16 }}>
          {Platform.OS === "web" ? (
            <Callout
              tone="info"
              title="Camera scanning is mobile-only"
              body="Use Paste link or Enter key in the browser. The mobile app scans QR codes directly."
            />
          ) : !permission ? (
            <Card>
              <AppText variant="small">Preparing the camera…</AppText>
            </Card>
          ) : !permission.granted ? (
            <Card style={{ alignItems: "center", paddingVertical: 28, gap: 12 }}>
              <View
                style={[
                  styles.permissionIcon,
                  { backgroundColor: theme.colors.accentFaint },
                ]}
              >
                <Feather name="camera" size={26} color={theme.colors.accent} />
              </View>
              <AppText variant="h3" align="center">
                Camera access needed
              </AppText>
              <AppText variant="small" align="center" style={{ maxWidth: 280 }}>
                The camera is used only to read QR codes. Nothing is recorded or
                uploaded.
              </AppText>
              <Button
                label="Allow camera"
                icon="camera"
                fullWidth={false}
                onPress={requestPermission}
                style={{ marginTop: 4 }}
              />
            </Card>
          ) : (
            <View
              style={[
                styles.cameraFrame,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.cardStrong,
                },
              ]}
            >
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={
                  scanning ? (result) => handlePayload(result.data) : undefined
                }
              />
              <View style={styles.viewfinder} pointerEvents="none">
                {(["tl", "tr", "bl", "br"] as const).map((corner) => (
                  <View
                    key={corner}
                    style={[
                      styles.corner,
                      corner.includes("t") ? { top: 0 } : { bottom: 0 },
                      corner.includes("l") ? { left: 0 } : { right: 0 },
                      {
                        borderColor: theme.colors.accent,
                        borderTopWidth: corner.includes("t") ? 3 : 0,
                        borderBottomWidth: corner.includes("b") ? 3 : 0,
                        borderLeftWidth: corner.includes("l") ? 3 : 0,
                        borderRightWidth: corner.includes("r") ? 3 : 0,
                      },
                    ]}
                  />
                ))}
                <View
                  style={[
                    styles.scanPill,
                    { backgroundColor: "rgba(0,0,0,0.55)" },
                  ]}
                >
                  <Feather name="maximize" size={13} color="#FFFFFF" />
                  <AppText variant="small" style={{ color: "#FFFFFF", fontSize: 12 }}>
                    Align the QR code inside the frame
                  </AppText>
                </View>
              </View>
            </View>
          )}

          {parseError ? (
            <Callout tone="danger" body={parseError} style={{ marginTop: 12 }} />
          ) : null}

          {Platform.OS !== "web" ? (
            <View style={{ marginTop: 12, alignItems: "center" }}>
              <LinkButton
                label="Import from Google Authenticator"
                icon="download"
                onPress={() => setMode("paste")}
              />
              <AppText
                variant="small"
                align="center"
                style={{ fontSize: 11.5, marginTop: 2, maxWidth: 300, opacity: 0.8 }}
              >
                In Google Authenticator choose Transfer accounts → Export accounts,
                then paste the migration link here.
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      {mode === "manual" ? (
        <View style={{ gap: 16, marginTop: 16 }}>
          <Callout
            tone="info"
            body="The service shows a setup key like JBSW Y3DP EHPK 3PXP. Spaces and dashes are ignored."
          />
          <Field
            label="SECRET KEY"
            value={secret}
            onChangeText={(value) => {
              setSecret(value);
              setManualError(null);
            }}
            placeholder="JBSWY3DPEHPK3PXP"
            icon="hash"
            mono
            autoCapitalize="characters"
            autoFocus
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Field
              label="SERVICE / ISSUER"
              value={issuer}
              onChangeText={setIssuer}
              placeholder="GitHub"
              autoCapitalize="words"
              style={{ flex: 1 }}
            />
            <Field
              label="ACCOUNT"
              value={label}
              onChangeText={setLabel}
              placeholder="you@example.com"
              style={{ flex: 1 }}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Field
              label="DIGITS"
              value={digits}
              onChangeText={setDigits}
              keyboardType="number-pad"
              maxLength={1}
              mono
              style={{ flex: 1 }}
            />
            <Field
              label="PERIOD"
              value={period}
              onChangeText={setPeriod}
              keyboardType="number-pad"
              maxLength={3}
              mono
              style={{ flex: 1 }}
            />
          </View>
          <View>
            <AppText variant="label" style={{ marginBottom: 7, marginLeft: 2 }}>
              ALGORITHM
            </AppText>
            <ChipRow
              options={[
                { key: "SHA1", label: "SHA-1" },
                { key: "SHA256", label: "SHA-256" },
                { key: "SHA512", label: "SHA-512" },
              ]}
              value={algorithm}
              onChange={(value) => setAlgorithm(value as TotpAlgorithm)}
            />
          </View>

          {preview ? (
            <Card tone="accent" style={{ paddingVertical: 14 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ gap: 1 }}>
                  <AppText variant="caption" color={theme.colors.accent}>
                    Live preview
                  </AppText>
                  <AppText
                    style={{
                      fontFamily: theme.font.mono,
                      fontSize: 25,
                      letterSpacing: 2,
                      color: theme.colors.text,
                    }}
                  >
                    {formatTotpCode(preview)}
                  </AppText>
                </View>
                <Feather name="check-circle" size={20} color={theme.colors.accent} />
              </View>
            </Card>
          ) : null}

          {manualError ? <Callout tone="danger" body={manualError} /> : null}

          <Button
            label="Add authenticator"
            icon="plus"
            onPress={addManual}
            loading={importing}
            disabled={!secret.trim()}
          />
        </View>
      ) : null}

      {mode === "paste" ? (
        <View style={{ gap: 16, marginTop: 16 }}>
          <Callout
            tone="info"
            title="Paste an otpauth link"
            body="Useful on web, or when the QR code was sent to you as text. Migration links from Google Authenticator work too."
          />
          <Field
            label="OTPAUTH LINK"
            value={pasteValue}
            onChangeText={(value) => {
              setPasteValue(value);
              setPasteError(null);
            }}
            placeholder="otpauth://totp/GitHub:you?secret=…"
            icon="link"
            multiline
            inputStyle={{ minHeight: 100 }}
            autoCapitalize="none"
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              label="Paste from clipboard"
              icon="clipboard"
              variant="secondary"
              fullWidth={false}
              onPress={async () => {
                try {
                  const text = await Clipboard.getStringAsync();
                  if (text) {
                    setPasteValue(text);
                    setPasteError(null);
                  }
                } catch {
                  setPasteError("Could not read the clipboard.");
                }
              }}
              style={{ flex: 1 }}
            />
            <Button
              label="Import"
              icon="download"
              fullWidth={false}
              onPress={parsePaste}
              disabled={!pasteValue.trim()}
              style={{ flex: 1 }}
            />
          </View>
          {pasteError ? <Callout tone="danger" body={pasteError} /> : null}
        </View>
      ) : null}

      <SectionHeader title="Security note" />
      <Callout
        tone="success"
        title="Secrets never leave the device"
        body="The authenticator secret is encrypted with your vault key before storage. Only ciphertext is ever synced."
      />

      <Sheet
        visible={Boolean(parsed)}
        onClose={closeSheet}
        title={
          parsed && parsed.length > 1
            ? `Import ${parsed.length} authenticators?`
            : "Add this authenticator?"
        }
        subtitle="Review before saving to your encrypted vault."
        footer={
          <>
            <Button
              label={
                parsed && parsed.length > 1
                  ? `Import all ${parsed.length}`
                  : "Add to vault"
              }
              icon="download"
              onPress={confirmImport}
              loading={importing}
            />
            <Button label="Scan again" variant="ghost" onPress={closeSheet} />
          </>
        }
      >
        <View style={{ gap: 8 }}>
          {(parsed ?? []).slice(0, 12).map((entry, index) => (
            <Card key={`${entry.secret}-${index}`} tone="alt" style={{ padding: 13 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
                <View
                  style={[
                    styles.entryIcon,
                    { backgroundColor: theme.colors.accentFaint },
                  ]}
                >
                  <Feather name="hash" size={16} color={theme.colors.accent} />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <AppText variant="bodyStrong" numberOfLines={1} style={{ fontSize: 14 }}>
                    {[entry.issuer, entry.label].filter(Boolean).join(" · ") ||
                      "Authenticator"}
                  </AppText>
                  <AppText variant="small" style={{ fontSize: 11.5 }}>
                    {entry.algorithm} · {entry.digits} digits · {entry.period}s
                  </AppText>
                </View>
                <Feather name="check" size={16} color={theme.colors.accent} />
              </View>
            </Card>
          ))}
          {(parsed?.length ?? 0) > 12 ? (
            <AppText variant="small" align="center">
              and {parsed!.length - 12} more…
            </AppText>
          ) : null}
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraFrame: {
    height: 320,
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
  },
  viewfinder: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  corner: {
    position: "absolute",
    width: 38,
    height: 38,
    borderRadius: 10,
  },
  scanPill: {
    position: "absolute",
    bottom: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  permissionIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  entryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
