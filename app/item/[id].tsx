import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState, type ComponentProps } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Card, Divider } from "@/components/ui/Card";
import { IconTile } from "@/components/ui/IconTile";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Screen } from "@/components/ui/Screen";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { TotpCard } from "@/components/vault/TotpCard";
import { formatDate, relativeTime } from "@/lib/format";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { lastFour, itemIcon, itemTypeLabel } from "@/lib/vault/presentation";

type FeatherName = ComponentProps<typeof Feather>["name"];

function maskCardNumber(value?: string): string {
  if (!value) return "Not set";
  const clean = value.replace(/\s+/g, "");
  if (clean.length <= 4) return value;
  return `•••• •••• •••• ${clean.slice(-4)}`;
}

export default function ItemDetailScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { items, deleteItem, toggleFavorite } = useVault();

  const item = useMemo(
    () => items.find((entry) => entry.id === id),
    [id, items]
  );

  const [revealPassword, setRevealPassword] = useState(false);
  const [revealCard, setRevealCard] = useState(false);
  const [revealCvv, setRevealCvv] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const copy = async (label: string, value?: string) => {
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
          () => {}
        );
      }
      toast.show(`${label} copied`, "success");
    } catch {
      toast.show("Could not copy", "danger");
    }
  };

  const openUrl = async (value?: string) => {
    if (!value) return;
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    try {
      await Linking.openURL(url);
    } catch {
      toast.show("Could not open that link", "danger");
    }
  };

  const remove = async () => {
    if (!item) return;
    setDeleting(true);
    try {
      await deleteItem(item.id);
      setDeleteOpen(false);
      toast.show("Item deleted", "danger");
      router.back();
    } catch (caught) {
      toast.show((caught as Error).message, "danger");
      setDeleting(false);
    }
  };

  if (!item) {
    return (
      <Screen>
        <PageHeader title="Not found" onBack={() => router.back()} />
        <Callout
          tone="warning"
          title="This item is gone"
          body="It may have been deleted here or on another synced device."
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

  const typeLabel = itemTypeLabel(item);

  return (
    <Screen bottomPadding={48}>
      <PageHeader
        eyebrow={typeLabel}
        title={item.name || "Untitled"}
        subtitle={[
          item.folder,
          `Updated ${relativeTime(item.updatedAt)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        onBack={() => router.back()}
        right={
          <>
            <Pressable
              onPress={() => toggleFavorite(item.id)}
              accessibilityRole="button"
              accessibilityLabel={item.favorite ? "Unfavorite" : "Favorite"}
              style={({ pressed }) => [
                styles.iconButton,
                {
                  backgroundColor: item.favorite
                    ? theme.colors.warningSoft
                    : theme.colors.cardAlt,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather
                name="star"
                size={18}
                color={item.favorite ? theme.colors.warning : theme.colors.textMuted}
              />
            </Pressable>
            <Pressable
              onPress={() => router.push(`/item/edit?id=${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel="Edit item"
              style={({ pressed }) => [
                styles.iconButton,
                {
                  backgroundColor: theme.colors.accentSoft,
                  opacity: pressed ? 0.6 : 1,
                },
              ]}
            >
              <Feather name="edit-3" size={17} color={theme.colors.accent} />
            </Pressable>
          </>
        }
      />

      <View style={styles.identity}>
        <IconTile
          icon={itemIcon(item) as FeatherName}
          seed={item.name || item.id}
          size={50}
        />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {item.name || "Untitled"}
          </AppText>
          <AppText variant="small" style={{ fontSize: 12.5 }} numberOfLines={1}>
            {item.folder ? `${item.folder} · ` : ""}
            {typeLabel}
          </AppText>
        </View>
      </View>

      {item.type === "login" ? (
        <>
          <SectionHeader title="Credentials" />
          <Card style={{ paddingVertical: 2 }}>
            {item.username ? (
              <InfoRow
                icon="user"
                label="Username"
                value={item.username}
                onCopy={() => copy("Username", item.username)}
              />
            ) : null}
            {item.password ? (
              <>
                {item.username ? <Divider style={{ marginLeft: 52 }} /> : null}
                <InfoRow
                  icon="lock"
                  label="Password"
                  value={revealPassword ? item.password : "••••••••••••"}
                  mono
                  onCopy={() => copy("Password", item.password)}
                  trailing={
                    <Pressable
                      onPress={() => setRevealPassword((current) => !current)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={
                        revealPassword ? "Hide password" : "Show password"
                      }
                    >
                      <Feather
                        name={revealPassword ? "eye-off" : "eye"}
                        size={16}
                        color={theme.colors.textMuted}
                      />
                    </Pressable>
                  }
                />
              </>
            ) : null}
            {item.urls?.[0] ? (
              <>
                <Divider style={{ marginLeft: 52 }} />
                <InfoRow
                  icon="globe"
                  label="Website"
                  value={item.urls[0].replace(/^https?:\/\//, "")}
                  onPress={() => openUrl(item.urls?.[0])}
                  trailing={
                    <Feather
                      name="external-link"
                      size={15}
                      color={theme.colors.textMuted}
                    />
                  }
                />
              </>
            ) : null}
          </Card>
        </>
      ) : null}

      {item.passkey ? (
        <>
          <SectionHeader title="Passkey" />
          <Card style={{ paddingVertical: 2 }}>
            <InfoRow
              icon="key"
              label="Relying party"
              value={item.passkey.rpId}
            />
            <Divider style={{ marginLeft: 52 }} />
            <InfoRow
              icon="shield"
              label="Credential ID"
              value={lastFour(item.passkey.credentialId)}
              mono
            />
            <Divider style={{ marginLeft: 52 }} />
            <InfoRow
              icon="clock"
              label="Created"
              value={formatDate(item.passkey.createdAt)}
            />
            {item.passkey.lastUsedAt ? (
              <>
                <Divider style={{ marginLeft: 52 }} />
                <InfoRow
                  icon="activity"
                  label="Last used"
                  value={formatDate(item.passkey.lastUsedAt)}
                />
              </>
            ) : null}
          </Card>
          <Callout
            tone="info"
            title="Sign in with a passkey"
            body="Android offers this passkey in apps and privileged browsers. FlexiVault asks for your fingerprint, face, or screen lock before signing."
            style={{ marginTop: 10 }}
          />
        </>
      ) : null}

      {item.totp?.secret ? (
        <View style={{ marginTop: 20 }}>
          <TotpCard item={item} onOpen={() => router.push(`/item/edit?id=${item.id}`)} />
        </View>
      ) : null}

      {item.type === "card" ? (
        <>
          <SectionHeader title="Card details" />
          <Card style={{ paddingVertical: 2 }}>
            {item.card?.number ? (
              <InfoRow
                icon="credit-card"
                label="Card number"
                value={
                  revealCard
                    ? item.card.number
                    : item.card.number.length <= 4
                      ? item.card.number
                      : maskCardNumber(item.card.number)
                }
                mono
                onCopy={() => copy("Card number", item.card?.number)}
                trailing={
                  <Pressable
                    onPress={() => setRevealCard((current) => !current)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={revealCard ? "Hide card number" : "Show card number"}
                  >
                    <Feather
                      name={revealCard ? "eye-off" : "eye"}
                      size={16}
                      color={theme.colors.textMuted}
                    />
                  </Pressable>
                }
              />
            ) : null}
            {item.card?.holder ? (
              <>
                <Divider style={{ marginLeft: 52 }} />
                <InfoRow
                  icon="user"
                  label="Cardholder"
                  value={item.card.holder}
                  onCopy={() => copy("Cardholder", item.card?.holder)}
                />
              </>
            ) : null}
            {item.card?.expiry ? (
              <>
                <Divider style={{ marginLeft: 52 }} />
                <InfoRow icon="calendar" label="Expiry" value={item.card.expiry} />
              </>
            ) : null}
            {item.card?.cvv ? (
              <>
                <Divider style={{ marginLeft: 52 }} />
                <InfoRow
                  icon="shield"
                  label="Security code"
                  value={revealCvv ? item.card.cvv : "•••"}
                  mono
                  onCopy={() => copy("Security code", item.card?.cvv)}
                  trailing={
                    <Pressable
                      onPress={() => setRevealCvv((current) => !current)}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={revealCvv ? "Hide security code" : "Show security code"}
                    >
                      <Feather
                        name={revealCvv ? "eye-off" : "eye"}
                        size={16}
                        color={theme.colors.textMuted}
                      />
                    </Pressable>
                  }
                />
              </>
            ) : null}
            {item.card?.brand ? (
              <>
                <Divider style={{ marginLeft: 52 }} />
                <InfoRow icon="tag" label="Brand" value={item.card.brand} />
              </>
            ) : null}
            {!item.card?.number && !item.card?.holder ? (
              <View style={{ padding: 14 }}>
                <AppText variant="small">No card details saved yet.</AppText>
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      {item.type === "identity" ? (
        <>
          <SectionHeader title="Identity" />
          <Card style={{ paddingVertical: 2 }}>
            {[
              ["user", "Full name", item.identity?.fullName],
              ["mail", "Email", item.identity?.email],
              ["phone", "Phone", item.identity?.phone],
              ["map-pin", "Address", item.identity?.address],
              ["briefcase", "Company", item.identity?.company],
              ["credit-card", "Passport / ID", item.identity?.passport],
            ]
              .filter(([, , value]) => Boolean(value))
              .map(([icon, label, value], index, list) => (
                <View key={String(label)}>
                  <InfoRow
                    icon={icon as FeatherName}
                    label={String(label)}
                    value={String(value)}
                    onCopy={() => copy(String(label), String(value))}
                  />
                  {index < list.length - 1 ? (
                    <Divider style={{ marginLeft: 52 }} />
                  ) : null}
                </View>
              ))}
            {!item.identity?.fullName &&
            !item.identity?.email &&
            !item.identity?.phone &&
            !item.identity?.address ? (
              <View style={{ padding: 14 }}>
                <AppText variant="small">No identity details saved yet.</AppText>
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      {item.notes?.trim() ? (
        <>
          <SectionHeader title="Notes" />
          <Card>
            <AppText
              variant="small"
              selectable
              style={{ fontSize: 14, lineHeight: 21, color: theme.colors.text }}
            >
              {item.notes}
            </AppText>
          </Card>
        </>
      ) : null}

      <SectionHeader title="About" />
      <Card style={{ paddingVertical: 2 }}>
        <InfoRow icon="clock" label="Created" value={formatDate(item.createdAt)} />
        <Divider style={{ marginLeft: 52 }} />
        <InfoRow
          icon="refresh-cw"
          label="Last updated"
          value={formatDate(item.updatedAt)}
        />
        <Divider style={{ marginLeft: 52 }} />
        <InfoRow icon="hash" label="Item ID" value={lastFour(item.id)} mono />
      </Card>

      <View style={{ marginTop: 24, gap: 10 }}>
        <Button
          label="Edit item"
          icon="edit-3"
          variant="secondary"
          onPress={() => router.push(`/item/edit?id=${item.id}`)}
        />
        <Button
          label="Delete item"
          icon="trash-2"
          variant="danger"
          onPress={() => setDeleteOpen(true)}
        />
      </View>

      <Sheet
        visible={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this item?"
        subtitle="A tombstone syncs the deletion to your other devices."
        footer={
          <>
            <Button
              label="Delete everywhere"
              icon="trash-2"
              variant="danger"
              loading={deleting}
              onPress={remove}
            />
            <Button
              label="Keep item"
              variant="ghost"
              onPress={() => setDeleteOpen(false)}
            />
          </>
        }
      >
        <Callout
          tone="danger"
          title={`“${item.name || "Untitled"}” will be removed`}
          body="There is no undo. If a server is connected, the ciphertext is deleted from the synced vault as well."
        />
      </Sheet>
    </Screen>
  );
}

function InfoRow({
  icon,
  label,
  value,
  onCopy,
  onPress,
  trailing,
  mono,
}: {
  icon: FeatherName;
  label: string;
  value?: string;
  onCopy?: () => void;
  onPress?: () => void;
  trailing?: React.ReactNode;
  mono?: boolean;
}) {
  const theme = useAppTheme();

  const body = (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Feather name={icon} size={15} color={theme.colors.textFaint} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="caption" style={{ fontSize: 9.5 }}>
          {label}
        </AppText>
        <AppText
          style={{
            fontFamily: mono ? theme.font.mono : theme.font.medium,
            fontSize: mono ? 13 : 14,
            lineHeight: 20,
            color: theme.colors.text,
          }}
          selectable
          numberOfLines={2}
        >
          {value || "Not set"}
        </AppText>
      </View>
      {trailing}
      {onCopy ? (
        <Pressable
          onPress={onCopy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label}`}
          style={{ paddingLeft: 4 }}
        >
          <Feather name="copy" size={14} color={theme.colors.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1 }]}
      >
        {body}
      </Pressable>
    );
  }

  return body;
}

const styles = StyleSheet.create({
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  rowIcon: {
    width: 29,
    alignItems: "center",
  },
});
