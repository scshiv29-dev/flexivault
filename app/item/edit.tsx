import { Feather } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button, LinkButton } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card } from "@/components/ui/Card";
import { ChipRow } from "@/components/ui/ChipRow";
import { Field } from "@/components/ui/Field";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Screen } from "@/components/ui/Screen";
import { Sheet } from "@/components/ui/Sheet";
import { StrengthBar } from "@/components/ui/StrengthBar";
import { useToast } from "@/components/ui/Toast";
import { useVault } from "@/lib/state/vault-provider";
import type { NewVaultItem } from "@/lib/state/vault-helpers";
import { useAppTheme } from "@/lib/theme";
import {
  DEFAULT_PASSWORD_OPTIONS,
  generatePassword,
  passwordStrength,
  type PasswordOptions,
} from "@/lib/vault/generator";
import { groupNames } from "@/lib/vault/groups";
import {
  isAndroidPackageName,
  MAX_ANDROID_PACKAGES,
  parseAndroidPackages,
} from "@/lib/vault/autofill";
import { isValidBase32, normaliseBase32, base32Decode } from "@/lib/vault/otp";
import type {
  TotpAlgorithm,
  VaultItem,
  VaultItemType,
} from "@/lib/vault/types";

const TYPE_META: Record<
  VaultItemType,
  { title: string; eyebrow: string; icon: "key" | "hash" | "file-text" | "credit-card" | "user" }
> = {
  login: { title: "Login", eyebrow: "New login", icon: "key" },
  totp: { title: "Authenticator", eyebrow: "New authenticator", icon: "hash" },
  note: { title: "Secure note", eyebrow: "New note", icon: "file-text" },
  card: { title: "Card", eyebrow: "New card", icon: "credit-card" },
  identity: { title: "Identity", eyebrow: "New identity", icon: "user" },
};

function isType(value?: string): value is VaultItemType {
  return (
    value === "login" ||
    value === "totp" ||
    value === "note" ||
    value === "card" ||
    value === "identity"
  );
}

function validPeriod(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(10, Math.min(300, parsed));
}

function validDigits(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return parsed === 8 ? 8 : parsed === 7 ? 7 : 6;
}

export default function EditItemScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const { id, type: typeParam, group: groupParam } = useLocalSearchParams<{
    id?: string;
    type?: string;
    group?: string;
  }>();
  const { items, addItem, updateItem } = useVault();

  const existing = useMemo(
    () => (id ? items.find((entry) => entry.id === id) : undefined),
    [id, items]
  );
  const type: VaultItemType = existing?.type ?? (isType(typeParam) ? typeParam : "login");
  const meta = TYPE_META[type];
  const editing = Boolean(existing);
  const groups = useMemo(() => groupNames(items), [items]);
  const groupFromRoute = typeof groupParam === "string" ? groupParam : "";

  const [name, setName] = useState(existing?.name ?? "");
  const [folder, setFolder] = useState(existing?.folder ?? groupFromRoute);
  const [favorite, setFavorite] = useState(Boolean(existing?.favorite));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [url, setUrl] = useState(existing?.urls?.[0] ?? "");
  const [androidPackages, setAndroidPackages] = useState(
    existing?.androidPackages?.join(", ") ?? ""
  );

  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState(existing?.password ?? "");

  const [cardNumber, setCardNumber] = useState(existing?.card?.number ?? "");
  const [cardHolder, setCardHolder] = useState(existing?.card?.holder ?? "");
  const [cardExpiry, setCardExpiry] = useState(existing?.card?.expiry ?? "");
  const [cardCvv, setCardCvv] = useState(existing?.card?.cvv ?? "");
  const [cardBrand, setCardBrand] = useState(existing?.card?.brand ?? "");

  const [fullName, setFullName] = useState(existing?.identity?.fullName ?? "");
  const [identityEmail, setIdentityEmail] = useState(existing?.identity?.email ?? "");
  const [phone, setPhone] = useState(existing?.identity?.phone ?? "");
  const [address, setAddress] = useState(existing?.identity?.address ?? "");
  const [company, setCompany] = useState(existing?.identity?.company ?? "");
  const [passport, setPassport] = useState(existing?.identity?.passport ?? "");

  const hasExistingTotp = Boolean(existing?.totp?.secret);
  const [totpEnabled, setTotpEnabled] = useState(type === "totp" || hasExistingTotp);
  const [totpSecret, setTotpSecret] = useState(existing?.totp?.secret ?? "");
  const [totpIssuer, setTotpIssuer] = useState(existing?.totp?.issuer ?? "");
  const [totpLabel, setTotpLabel] = useState(existing?.totp?.label ?? "");
  const [algorithm, setAlgorithm] = useState<TotpAlgorithm>(
    existing?.totp?.algorithm ?? "SHA1"
  );
  const [digits, setDigits] = useState(String(existing?.totp?.digits ?? 6));
  const [period, setPeriod] = useState(String(existing?.totp?.period ?? 30));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [passwordOptions, setPasswordOptions] = useState<PasswordOptions>(
    DEFAULT_PASSWORD_OPTIONS
  );

  const strength = passwordStrength(password);

  const generate = (options = passwordOptions) => {
    try {
      const next = generatePassword(options);
      setPassword(next);
      setError(null);
      if (Platform.OS !== "web") {
        Haptics.selectionAsync().catch(() => {});
      }
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const makeTotp = () => {
    const secret = normaliseBase32(totpSecret);
    if (!secret) throw new Error("Enter the authenticator secret.");
    if (!isValidBase32(secret)) {
      throw new Error("That secret is not valid base32. Check the QR code or entry.");
    }
    try {
      base32Decode(secret);
    } catch {
      throw new Error("That secret could not be decoded.");
    }

    return {
      secret,
      algorithm,
      digits: validDigits(digits),
      period: validPeriod(period),
      issuer: totpIssuer.trim() || undefined,
      label: totpLabel.trim() || undefined,
    };
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Give this item a name so you can find it later.");
      return;
    }

    let totp = null;
    try {
      if (type === "totp" || (type === "login" && totpEnabled)) {
        totp = makeTotp();
      }
    } catch (caught) {
      setError((caught as Error).message);
      return;
    }

    let packages: string[] = [];
    if (type === "login" && androidPackages.trim()) {
      const tokens = androidPackages
        .split(/[\s,;]+/)
        .map((token) => token.trim())
        .filter(Boolean);
      const invalid = tokens.find((token) => !isAndroidPackageName(token));
      if (invalid) {
        setError(
          `"${invalid}" is not a valid Android package name. Use a value like com.example.app.`
        );
        return;
      }
      if (new Set(tokens).size > MAX_ANDROID_PACKAGES) {
        setError(`Use at most ${MAX_ANDROID_PACKAGES} Android package names.`);
        return;
      }
      packages = parseAndroidPackages(androidPackages);
    }

    const draft: NewVaultItem = {
      type,
      name: name.trim(),
      folder: folder.trim() || undefined,
      favorite,
      notes: notes.trim() || undefined,
      urls: url.trim() ? [url.trim()] : [],
      totp,
    };

    if (type === "login") {
      draft.username = username.trim() || undefined;
      draft.password = password || undefined;
      draft.androidPackages = packages.length > 0 ? packages : undefined;
    }

    if (type === "totp") {
      draft.username = totp?.label;
      draft.name = name.trim() || totp?.issuer || "Authenticator";
    }

    if (type === "card") {
      draft.card = {
        number: cardNumber.trim() || undefined,
        holder: cardHolder.trim() || undefined,
        expiry: cardExpiry.trim() || undefined,
        cvv: cardCvv.trim() || undefined,
        brand: cardBrand.trim() || undefined,
      };
    }

    if (type === "identity") {
      draft.identity = {
        fullName: fullName.trim() || undefined,
        email: identityEmail.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        company: company.trim() || undefined,
        passport: passport.trim() || undefined,
      };
    }

    Keyboard.dismiss();
    setSaving(true);
    try {
      if (existing) {
        await updateItem({ ...existing, ...draft } as VaultItem);
        toast.show("Changes saved", "success");
        router.back();
      } else {
        const created = await addItem(draft);
        toast.show("Added to your vault", "success");
        router.replace(`/item/${created.id}`);
      }
    } catch (caught) {
      setError((caught as Error).message);
      setSaving(false);
    }
  };

  const toggleOption = (key: "uppercase" | "numbers" | "symbols" | "excludeAmbiguous") => {
    setPasswordOptions((current) => ({ ...current, [key]: !current[key] }));
  };

  if (id && !existing) {
    return (
      <Screen>
        <PageHeader title="Not found" onBack={() => router.back()} />
        <Callout
          tone="danger"
          title="This item no longer exists"
          body="It may have been deleted on another device and synced over."
        />
        <Button
          label="Back to vault"
          variant="secondary"
          onPress={() => router.replace("/(tabs)")}
          style={{ marginTop: 16 }}
        />
      </Screen>
    );
  }

  return (
    <Screen keyboard bottomPadding={48}>
      <PageHeader
        eyebrow={editing ? "Edit item" : meta.eyebrow}
        title={editing ? "Edit item" : meta.title}
        subtitle={
          type === "login"
            ? "Saved encrypted on-device and synced as ciphertext."
            : "Encrypted before it touches the disk."
        }
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => setFavorite((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={favorite ? "Remove from favorites" : "Add to favorites"}
            style={({ pressed }) => [
              styles.favorite,
              {
                backgroundColor: favorite
                  ? theme.colors.warningSoft
                  : theme.colors.cardAlt,
                opacity: pressed ? 0.6 : 1,
              },
            ]}
          >
            <Feather
              name="star"
              size={18}
              color={favorite ? theme.colors.warning : theme.colors.textMuted}
            />
          </Pressable>
        }
      />

      <View style={{ gap: 16 }}>
        <Field
          label="NAME"
          value={name}
          onChangeText={(value) => {
            setName(value);
            setError(null);
          }}
          placeholder={
            type === "login"
              ? "e.g. GitHub"
              : type === "card"
                ? "e.g. Travel card"
                : type === "identity"
                  ? "e.g. Passport"
                  : "e.g. Personal notes"
          }
          autoCapitalize="words"
          autoFocus={!editing}
        />

        {type === "login" ? (
          <>
            <Field
              label="USERNAME OR EMAIL"
              value={username}
              onChangeText={setUsername}
              placeholder="you@example.com"
              autoComplete="username"
              textContentType="username"
            />
            <View>
              <Field
                label="PASSWORD"
                value={password}
                onChangeText={setPassword}
                placeholder="Leave blank or generate one"
                secure
                autoComplete="new-password"
                textContentType="newPassword"
                right={
                  <Pressable
                    onPress={() => generate()}
                    accessibilityRole="button"
                    accessibilityLabel="Generate password"
                    hitSlop={8}
                  >
                    <Feather name="zap" size={18} color={theme.colors.accent} />
                  </Pressable>
                }
              />
              {password ? (
                <View style={{ marginTop: 8, marginHorizontal: 2 }}>
                  <StrengthBar
                    score={strength.score}
                    fraction={strength.fraction}
                    label={strength.label}
                  />
                </View>
              ) : null}
              <View style={{ flexDirection: "row", gap: 16, marginTop: 2 }}>
                <LinkButton
                  label="Password options"
                  icon="sliders"
                  onPress={() => setGeneratorOpen(true)}
                />
                {password ? (
                  <LinkButton
                    label="Clear"
                    color={theme.colors.textMuted}
                    onPress={() => setPassword("")}
                  />
                ) : null}
              </View>
            </View>
            <Field
              label="WEBSITE"
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com"
              icon="globe"
              keyboardType="url"
              autoComplete="url"
            />
            <Field
              label="ANDROID APP PACKAGE (OPTIONAL)"
              value={androidPackages}
              onChangeText={setAndroidPackages}
              placeholder="com.example.app"
              icon="smartphone"
              autoCapitalize="none"
              hint="Used for autofill in native Android apps. Find it in the app's Play Store URL after id=, or in Android app info."
            />
          </>
        ) : null}

        {type === "card" ? (
          <>
            <Field
              label="CARD NUMBER"
              value={cardNumber}
              onChangeText={setCardNumber}
              placeholder="4242 4242 4242 4242"
              icon="credit-card"
              keyboardType="number-pad"
              mono
              maxLength={23}
            />
            <Field
              label="CARDHOLDER"
              value={cardHolder}
              onChangeText={setCardHolder}
              placeholder="Name on the card"
              autoCapitalize="words"
              autoComplete="cc-name"
            />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label="EXPIRY"
                  value={cardExpiry}
                  onChangeText={setCardExpiry}
                  placeholder="MM / YY"
                  keyboardType="numbers-and-punctuation"
                  maxLength={7}
                  mono
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label="CVV"
                  value={cardCvv}
                  onChangeText={setCardCvv}
                  placeholder="123"
                  keyboardType="number-pad"
                  secure
                  maxLength={4}
                  mono
                />
              </View>
            </View>
            <Field
              label="BRAND"
              value={cardBrand}
              onChangeText={setCardBrand}
              placeholder="Visa, Mastercard…"
              autoCapitalize="words"
            />
            <Field
              label="BILLING WEBSITE (OPTIONAL)"
              value={url}
              onChangeText={setUrl}
              placeholder="https://example.com"
              icon="globe"
              keyboardType="url"
            />
          </>
        ) : null}

        {type === "identity" ? (
          <>
            <Field
              label="FULL NAME"
              value={fullName}
              onChangeText={setFullName}
              placeholder="Ada Lovelace"
              icon="user"
              autoCapitalize="words"
              autoComplete="name"
            />
            <Field
              label="EMAIL"
              value={identityEmail}
              onChangeText={setIdentityEmail}
              placeholder="ada@example.com"
              icon="mail"
              keyboardType="email-address"
              autoComplete="email"
            />
            <Field
              label="PHONE"
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 555 0100"
              icon="phone"
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <Field
              label="ADDRESS"
              value={address}
              onChangeText={setAddress}
              placeholder="Street, city, country"
              icon="map-pin"
              multiline
            />
            <Field
              label="COMPANY"
              value={company}
              onChangeText={setCompany}
              placeholder="Optional"
              icon="briefcase"
              autoCapitalize="words"
            />
            <Field
              label="PASSPORT / ID NUMBER"
              value={passport}
              onChangeText={setPassport}
              placeholder="Optional"
              icon="credit-card"
              mono
            />
          </>
        ) : null}

        {type === "login" ? (
          <>
            <SectionHeader title="Two-factor authentication" style={{ marginTop: 8 }} />
            <Card style={{ padding: 15 }}>
              <Pressable
                onPress={() => setTotpEnabled((current) => !current)}
                style={({ pressed }) => [styles.toggleRow, { opacity: pressed ? 0.7 : 1 }]}
                accessibilityRole="switch"
                accessibilityState={{ checked: totpEnabled }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
                    Add an authenticator
                  </AppText>
                  <AppText variant="small" style={{ fontSize: 12.5 }}>
                    Generate 6-digit codes next to this login.
                  </AppText>
                </View>
                <View
                  style={[
                    styles.switch,
                    {
                      backgroundColor: totpEnabled
                        ? theme.colors.accent
                        : theme.colors.cardStrong,
                      alignItems: totpEnabled ? "flex-end" : "flex-start",
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.knob,
                      {
                        backgroundColor: totpEnabled
                          ? theme.colors.accentInk
                          : theme.colors.textFaint,
                      },
                    ]}
                  />
                </View>
              </Pressable>
            </Card>
          </>
        ) : null}

        {type === "totp" || (type === "login" && totpEnabled) ? (
          <View style={{ gap: 14 }}>
            {type === "login" ? (
              <Callout
                tone="info"
                body="Paste the secret from the service's 2FA setup page, or scan its QR code from the Codes tab."
              />
            ) : null}
            <Field
              label="SECRET KEY"
              value={totpSecret}
              onChangeText={setTotpSecret}
              placeholder="JBSWY3DPEHPK3PXP"
              icon="hash"
              mono
              autoCapitalize="characters"
              hint="Spaces and dashes are ignored."
            />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Field
                label="ISSUER"
                value={totpIssuer}
                onChangeText={setTotpIssuer}
                placeholder="GitHub"
                autoCapitalize="words"
                style={{ flex: 1 }}
              />
              <Field
                label="ACCOUNT"
                value={totpLabel}
                onChangeText={setTotpLabel}
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
                label="PERIOD (SECONDS)"
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
          </View>
        ) : null}

        {type === "note" ? (
          <Field
            label="NOTE"
            value={notes}
            onChangeText={setNotes}
            placeholder="Write anything. It stays encrypted."
            multiline
            autoCapitalize="sentences"
            inputStyle={{ minHeight: 190 }}
          />
        ) : null}

        {type !== "note" ? (
          <Field
            label="NOTES (OPTIONAL)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Recovery codes, context, reminders…"
            multiline
            autoCapitalize="sentences"
            inputStyle={{ minHeight: 120 }}
          />
        ) : null}

        <Field
          label="GROUP (OPTIONAL)"
          value={folder}
          onChangeText={setFolder}
          placeholder="e.g. Work, Banking, Family"
          icon="folder"
          autoCapitalize="words"
          hint="Groups are encrypted with the item and sync with your vault."
        />
        {groups.length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <AppText
              variant="label"
              style={{ marginBottom: 7, marginLeft: 2 }}
            >
              EXISTING GROUPS
            </AppText>
            <ChipRow
              options={[
                { key: "", label: "No group" },
                ...groups.map((name) => ({ key: name, label: name })),
              ]}
              value={folder}
              onChange={setFolder}
            />
          </View>
        ) : null}
      </View>

      {error ? (
        <Callout tone="danger" body={error} style={{ marginTop: 16 }} />
      ) : null}

      <View style={{ marginTop: 22, gap: 10 }}>
        <Button
          label={editing ? "Save changes" : "Add to vault"}
          icon={editing ? "check" : "plus"}
          onPress={save}
          loading={saving}
          disabled={!name.trim()}
        />
        <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
      </View>

      <Sheet
        visible={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        title="Password generator"
        subtitle="Generated on-device with the platform CSPRNG."
        footer={
          <>
            <Button
              label="Use this password"
              icon="check"
              onPress={() => {
                generate();
                setGeneratorOpen(false);
              }}
            />
            <Button
              label="Generate again"
              variant="secondary"
              icon="refresh-cw"
              onPress={() => generate()}
            />
          </>
        }
      >
        <View style={{ gap: 16 }}>
          <Card tone="alt" style={{ padding: 14 }}>
            <AppText
              variant="mono"
              style={{ fontSize: 15, lineHeight: 23 }}
              selectable
            >
              {password || "Press generate to preview"}
            </AppText>
          </Card>

          <View>
            <AppText variant="label" style={{ marginBottom: 7 }}>
              LENGTH
            </AppText>
            <ChipRow
              options={[12, 16, 20, 24, 32].map((length) => ({
                key: String(length),
                label: `${length}`,
              }))}
              value={String(passwordOptions.length)}
              onChange={(value) =>
                setPasswordOptions((current) => ({
                  ...current,
                  length: Number(value),
                }))
              }
            />
          </View>

          <View style={{ gap: 8 }}>
            {(
              [
                ["uppercase", "Uppercase letters"],
                ["numbers", "Numbers"],
                ["symbols", "Symbols"],
                ["excludeAmbiguous", "Exclude look-alike characters"],
              ] as const
            ).map(([key, label]) => {
              const active = passwordOptions[key];
              return (
                <Pressable
                  key={key}
                  onPress={() => toggleOption(key)}
                  style={({ pressed }) => [
                    styles.optionRow,
                    {
                      backgroundColor: active
                        ? theme.colors.accentSoft
                        : theme.colors.card,
                      borderColor: active ? theme.colors.accent : theme.colors.border,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                >
                  <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
                    {label}
                  </AppText>
                  <Feather
                    name={active ? "check-circle" : "circle"}
                    size={17}
                    color={active ? theme.colors.accent : theme.colors.textFaint}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  favorite: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  switch: {
    width: 46,
    height: 27,
    borderRadius: 14,
    padding: 3,
    justifyContent: "center",
  },
  knob: {
    width: 21,
    height: 21,
    borderRadius: 11,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 13,
    borderWidth: 1,
  },
});
