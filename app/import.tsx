import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useState, type ComponentProps } from "react";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Screen } from "@/components/ui/Screen";
import { useToast } from "@/components/ui/Toast";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import {
  importPasswords,
  type ImportFormat,
  type ImportPreview,
  type ImportedVaultItem,
} from "@/lib/vault/importer";
import type { VaultItemType } from "@/lib/vault/types";

type FeatherName = ComponentProps<typeof Feather>["name"];

const MAX_IMPORT_ITEMS = 5000;

const FORMAT_LABEL: Record<ImportFormat, string> = {
  "bitwarden-csv": "Bitwarden CSV",
  "1password-csv": "1Password CSV",
  "chrome-csv": "Chrome / Edge / Brave CSV",
  "lastpass-csv": "LastPass CSV",
  "protonpass-csv": "Proton Pass CSV",
  "dashlane-csv": "Dashlane CSV",
  "keepass-csv": "KeePassXC CSV",
  "generic-csv": "Generic CSV",
  "bitwarden-json": "Bitwarden JSON",
  "generic-json": "Generic JSON",
};

const TYPE_META: Record<
  VaultItemType,
  { label: string; icon: FeatherName }
> = {
  login: { label: "Login", icon: "key" },
  note: { label: "Secure note", icon: "file-text" },
  card: { label: "Card", icon: "credit-card" },
  identity: { label: "Identity", icon: "user" },
  totp: { label: "Authenticator", icon: "hash" },
};

function draftSubtitle(draft: ImportedVaultItem): string {
  if (draft.type === "card") {
    return [draft.card?.brand, draft.card?.holder].filter(Boolean).join(" · ") || "Payment card";
  }
  if (draft.type === "note") {
    return draft.notes?.split("\n")[0]?.slice(0, 72) || "Secure note";
  }
  if (draft.type === "identity") {
    return draft.identity?.fullName || draft.identity?.email || "Identity";
  }
  if (draft.type === "totp") {
    return [draft.totp?.issuer, draft.totp?.label].filter(Boolean).join(" · ") || "Authenticator";
  }
  return (
    draft.username ||
    draft.urls?.[0]?.replace(/^https?:\/\//, "").replace(/\/$/, "") ||
    "Login"
  );
}

async function readPickedFile(uri: string): Promise<string> {
  try {
    return await new File(uri).text();
  } catch {
    // Web document pickers may return a data: or blob: URL instead of a
    // filesystem URI. fetch() handles both.
    const response = await fetch(uri);
    if (!response.ok) throw new Error("That file could not be read.");
    return response.text();
  }
}

function parseOrThrow(name: string, text: string): ImportPreview {
  const preview = importPasswords(name, text);
  if (preview.totalRows === 0) {
    throw new Error("The file has a header but no rows to import.");
  }
  return preview;
}

export default function ImportScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const { items, importItems } = useVault();

  const [sourceName, setSourceName] = useState<string | null>(null);
  const [pasteMode, setPasteMode] = useState(false);
  const [text, setText] = useState("");
  const [group, setGroup] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const drafts = preview?.drafts ?? [];
  const importedCount = drafts.length;
  const remainingCapacity = Math.max(0, MAX_IMPORT_ITEMS - items.length);
  const tooMany = importedCount > remainingCapacity;
  const canImport =
    importedCount > 0 && !tooMany && !busy && Boolean(preview);

  const pickFile = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "text/plain",
          "application/json",
          "application/vnd.ms-excel",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("No file was selected.");

      const content = await readPickedFile(asset.uri);
      const next = parseOrThrow(asset.name, content);
      setSourceName(asset.name);
      setText(content);
      setPasteMode(false);
      setPreview(next);
    } catch (caught) {
      setPreview(null);
      setSourceName(null);
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const parsePasted = () => {
    setError(null);
    const content = text.trim();
    if (!content) {
      setError("Paste a CSV or JSON export first.");
      return;
    }

    try {
      const name =
        content.startsWith("{") || content.startsWith("[")
          ? "pasted.json"
          : "pasted.csv";
      const next = parseOrThrow(name, content);
      setSourceName(name);
      setPreview(next);
    } catch (caught) {
      setPreview(null);
      setSourceName(null);
      setError((caught as Error).message);
    }
  };

  const runImport = async () => {
    if (!preview) return;
    setError(null);
    setBusy(true);

    const groupName = group.trim();
    const nextDrafts = preview.drafts.map((draft) =>
      groupName ? { ...draft, folder: groupName } : draft
    );

    try {
      await importItems(nextDrafts);
      toast.show(
        `${nextDrafts.length} ${nextDrafts.length === 1 ? "item" : "items"} imported`,
        "success"
      );
      router.replace("/(tabs)");
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  };

  const reset = () => {
    setSourceName(null);
    setText("");
    setPreview(null);
    setError(null);
    setPasteMode(false);
  };

  return (
    <Screen keyboard bottomPadding={48}>
      <PageHeader
        eyebrow="Move in"
        title="Import passwords"
        subtitle="Bring logins, notes, cards and authenticator secrets from another password manager. Everything is encrypted on this device before it is saved."
        onBack={() => router.back()}
      />

      <Callout
        tone="info"
        title="Use an unencrypted export"
        body="CSV exports and Bitwarden JSON are supported. Password-protected or encrypted backups cannot be read here; export plain CSV/JSON from the other app, import it, then delete the export file."
      />

      <SectionHeader title="Choose a source" />
      <Card style={{ padding: 14, gap: 10 }}>
        <View style={styles.sourceRow}>
          <View
            style={[
              styles.sourceIcon,
              { backgroundColor: theme.colors.accentFaint },
            ]}
          >
            <Feather name="upload" size={19} color={theme.colors.accent} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
              CSV or JSON file
            </AppText>
            <AppText variant="small" style={{ fontSize: 12 }}>
              Bitwarden, 1Password, Chrome, Edge, Brave, LastPass, Dashlane,
              Proton Pass, KeePassXC and generic exports.
            </AppText>
          </View>
        </View>
        <Button
          label={sourceName ? `Selected: ${sourceName}` : "Choose file"}
          icon="folder"
          variant="secondary"
          size="sm"
          onPress={pickFile}
          loading={busy && !preview}
        />
        <Button
          label="Paste CSV or JSON"
          icon="clipboard"
          variant="ghost"
          size="sm"
          onPress={() => setPasteMode((current) => !current)}
        />
      </Card>

      {pasteMode ? (
        <View style={{ marginTop: 14 }}>
          <Field
            label="PASTE EXPORT"
            value={text}
            onChangeText={(value) => {
              setText(value);
              setPreview(null);
              setSourceName(null);
              setError(null);
            }}
            placeholder={'name,url,username,password\nExample,https://example.com,me,secret'}
            multiline
            autoCapitalize="none"
            inputStyle={{ minHeight: 150, fontSize: 12 }}
            hint="The header row is used to detect the format."
          />
          <Button
            label="Preview import"
            icon="eye"
            variant="secondary"
            size="sm"
            onPress={parsePasted}
            style={{ marginTop: 10 }}
          />
        </View>
      ) : null}

      {error ? (
        <Callout tone="danger" body={error} style={{ marginTop: 14 }} />
      ) : null}

      {preview ? (
        <>
          <SectionHeader title="Preview" />
          <Card style={{ padding: 15, gap: 12 }}>
            <View style={styles.summaryRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyStrong" style={{ fontSize: 15 }}>
                  {importedCount} {importedCount === 1 ? "item" : "items"} found
                </AppText>
                <AppText variant="small" style={{ fontSize: 12 }}>
                  {FORMAT_LABEL[preview.format]}
                  {sourceName ? ` · ${sourceName}` : ""}
                </AppText>
              </View>
              <View
                style={[
                  styles.countBadge,
                  { backgroundColor: theme.colors.accentSoft },
                ]}
              >
                <Feather name="check" size={14} color={theme.colors.accent} />
              </View>
            </View>

            {preview.skipped > 0 ? (
              <AppText variant="small" color={theme.colors.warning}>
                {preview.skipped} row{preview.skipped === 1 ? "" : "s"} could not be
                read and will be skipped.
              </AppText>
            ) : null}

            {preview.warnings.length > 0 ? (
              <Callout
                tone="warning"
                title={`${preview.warnings.length} warning${preview.warnings.length === 1 ? "" : "s"}`}
                body={[
                  ...preview.warnings.slice(0, 3),
                  ...(preview.warnings.length > 3
                    ? [`…and ${preview.warnings.length - 3} more.`]
                    : []),
                ].join("\n")}
              />
            ) : null}

            <View style={{ gap: 8 }}>
              {drafts.slice(0, 6).map((draft, index) => {
                const meta = TYPE_META[draft.type];
                return (
                  <View
                    key={`${draft.name}-${index}`}
                    style={[
                      styles.previewRow,
                      { borderColor: theme.colors.border },
                    ]}
                  >
                    <View
                      style={[
                        styles.previewIcon,
                        { backgroundColor: theme.colors.cardAlt },
                      ]}
                    >
                      <Feather
                        name={meta.icon}
                        size={15}
                        color={theme.colors.accent}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <AppText
                        variant="bodyStrong"
                        style={{ fontSize: 13.5 }}
                        numberOfLines={1}
                      >
                        {draft.name}
                      </AppText>
                      <AppText
                        variant="small"
                        style={{ fontSize: 11.5 }}
                        numberOfLines={1}
                      >
                        {meta.label} · {draftSubtitle(draft)}
                      </AppText>
                    </View>
                    {draft.folder ? (
                      <AppText
                        variant="caption"
                        color={theme.colors.textMuted}
                        numberOfLines={1}
                        style={{ maxWidth: 90 }}
                      >
                        {draft.folder}
                      </AppText>
                    ) : null}
                  </View>
                );
              })}
              {drafts.length > 6 ? (
                <AppText variant="small" style={{ fontSize: 12 }}>
                  …and {drafts.length - 6} more.
                </AppText>
              ) : null}
            </View>
          </Card>

          <SectionHeader title="Organize" />
          <Field
            label="GROUP OVERRIDE (OPTIONAL)"
            value={group}
            onChangeText={setGroup}
            placeholder="e.g. Imported from Bitwarden"
            icon="folder"
            autoCapitalize="words"
            hint="Leave empty to keep the folders from the export. Set a group to put every imported item in one place."
          />

          {tooMany ? (
            <Callout
              tone="warning"
              body={`This import would exceed the ${MAX_IMPORT_ITEMS.toLocaleString()} item limit (${items.length.toLocaleString()} already saved, ${remainingCapacity.toLocaleString()} spaces left). Import a smaller file or split the export.`}
              style={{ marginTop: 14 }}
            />
          ) : null}

          <View style={{ marginTop: 18, gap: 10 }}>
            <Button
              label={
                importedCount > 0
                  ? `Import ${importedCount} ${importedCount === 1 ? "item" : "items"}`
                  : "Nothing to import"
              }
              icon="download"
              onPress={runImport}
              loading={busy}
              disabled={!canImport}
            />
            <Button label="Choose a different file" variant="ghost" onPress={reset} />
          </View>
        </>
      ) : null}

      <SectionHeader title="How it works" />
      <Card style={{ padding: 15, gap: 11 }}>
        {[
          "Export your vault from the other password manager as CSV or JSON.",
          "Pick the file here. Nothing is uploaded: parsing happens on this device.",
          "Groups become folders, logins keep their usernames, passwords and URLs, and valid TOTP secrets become live codes.",
          "Delete the export file after importing; it contains plaintext secrets.",
        ].map((line, index) => (
          <View key={line} style={styles.stepRow}>
            <View
              style={[styles.stepNumber, { backgroundColor: theme.colors.cardAlt }]}
            >
              <AppText variant="caption" color={theme.colors.accent}>
                {index + 1}
              </AppText>
            </View>
            <AppText variant="small" style={{ flex: 1, fontSize: 12.5 }}>
              {line}
            </AppText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  sourceIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  countBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  previewIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
});
