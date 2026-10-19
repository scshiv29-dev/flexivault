import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "@/components/ui/AppText";
import { Card, Divider } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconTile } from "@/components/ui/IconTile";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { SecurityScoreRing } from "@/components/ui/Rings";
import { Screen } from "@/components/ui/Screen";
import { ItemRow } from "@/components/vault/ItemRow";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { passwordStrength } from "@/lib/vault/generator";
import { analyzeSecurity } from "@/lib/vault/security";

export default function SecurityScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { items } = useVault();

  const report = useMemo(() => analyzeSecurity(items), [items]);
  const byId = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  );

  const gradient: [string, string] = theme.isDark
    ? ["#103128", theme.colors.card]
    : ["#E0F9EF", theme.colors.card];

  return (
    <Screen>
      <PageHeader
        eyebrow="Audit"
        title="Security"
        subtitle="A quiet check of what needs attention"
      />

      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          padding: 18,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          <SecurityScoreRing score={report.score} size={112} label="Health" />
          <View style={{ flex: 1, gap: 5 }}>
            <AppText variant="caption" color={theme.colors.accent}>
              {report.score >= 80
                ? "In good shape"
                : report.score >= 55
                  ? "Room to improve"
                  : "Action needed"}
            </AppText>
            <AppText variant="h1" style={{ fontSize: 24 }}>
              {report.label}
            </AppText>
            <AppText variant="small" style={{ fontSize: 12.5, lineHeight: 18 }}>
              {report.totalLogins} logins checked against weak, reused and stale
              passwords.
            </AppText>
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            marginTop: 18,
            paddingTop: 14,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          {[
            { label: "Weak", value: report.weak.length },
            { label: "Reused", value: report.reused.length },
            { label: "No 2FA", value: report.missing2fa.length },
          ].map((stat, index) => (
            <View
              key={stat.label}
              style={{
                flex: 1,
                paddingLeft: index === 0 ? 0 : 14,
                borderLeftWidth: index === 0 ? 0 : 1,
                borderLeftColor: theme.colors.border,
              }}
            >
              <AppText
                style={{
                  fontFamily: theme.font.display,
                  fontSize: 26,
                  color:
                    stat.value === 0
                      ? theme.colors.accent
                      : theme.colors.text,
                }}
              >
                {stat.value}
              </AppText>
              <AppText variant="caption" style={{ fontSize: 9 }}>
                {stat.label}
              </AppText>
            </View>
          ))}
        </View>
      </LinearGradient>

      {report.totalLogins === 0 ? (
        <EmptyState
          icon="shield"
          title="Nothing to audit yet"
          body="Add a login and FlexiVault will check it for weak, reused and stale passwords."
          actionLabel="Add a login"
          onAction={() => router.push("/item/edit?type=login")}
        />
      ) : (
        <>
          <SectionHeader title="What to fix first" />
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {report.suggestions.map((suggestion, index) => (
              <View key={suggestion}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 11,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                  }}
                >
                  <Feather
                    name={
                      report.suggestions.length === 1
                        ? "check-circle"
                        : "arrow-up-right"
                    }
                    size={15}
                    color={theme.colors.accent}
                    style={{ marginTop: 2 }}
                  />
                  <AppText
                    variant="small"
                    style={{ flex: 1, fontSize: 13, lineHeight: 19 }}
                  >
                    {suggestion}
                  </AppText>
                </View>
                {index < report.suggestions.length - 1 ? (
                  <Divider style={{ marginLeft: 14 }} />
                ) : null}
              </View>
            ))}
          </Card>

          {report.weak.length > 0 ? (
            <>
              <SectionHeader
                title={`Weak passwords · ${report.weak.length}`}
              />
              {report.weak.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onPress={() => router.push(`/item/${item.id}`)}
                  right={
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: theme.colors.dangerSoft,
                      }}
                    >
                      <AppText
                        variant="caption"
                        color={theme.colors.danger}
                        style={{ fontSize: 9 }}
                      >
                        {passwordStrength(item.password ?? "").label}
                      </AppText>
                    </View>
                  }
                />
              ))}
            </>
          ) : null}

          {report.reused.length > 0 ? (
            <>
              <SectionHeader title={`Reused passwords · ${report.reused.length}`} />
              <View style={{ gap: 9 }}>
                {report.reused.map((group, index) => {
                  const names = group.itemIds
                    .map((id) => byId.get(id)?.name)
                    .filter(Boolean) as string[];
                  return (
                    <Card
                      key={`${index}-${group.itemIds.join("-")}`}
                      style={{ padding: 13 }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 11,
                        }}
                      >
                        <IconTile icon="repeat" seed={group.password} size={38} />
                        <View style={{ flex: 1 }}>
                          <AppText variant="bodyStrong" style={{ fontSize: 14 }}>
                            One password, {group.itemIds.length} accounts
                          </AppText>
                          <AppText variant="small" style={{ fontSize: 12 }}>
                            {names.join(" · ")}
                          </AppText>
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </View>
            </>
          ) : null}

          {report.missing2fa.length > 0 ? (
            <>
              <SectionHeader
                title={`Missing two-factor · ${report.missing2fa.length}`}
              />
              {report.missing2fa.slice(0, 6).map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onPress={() => router.push(`/item/${item.id}`)}
                  right={
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <AppText
                        variant="label"
                        color={theme.colors.accent}
                        style={{ fontSize: 11 }}
                      >
                        Add
                      </AppText>
                      <Feather
                        name="plus"
                        size={12}
                        color={theme.colors.accent}
                      />
                    </View>
                  }
                />
              ))}
            </>
          ) : null}

          {report.stale.length > 0 ? (
            <>
              <SectionHeader title={`Older than a year · ${report.stale.length}`} />
              {report.stale.slice(0, 5).map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onPress={() => router.push(`/item/${item.id}`)}
                  right={
                    <AppText variant="caption" color={theme.colors.warning}>
                      Rotate
                    </AppText>
                  }
                />
              ))}
            </>
          ) : null}

          <Pressable
            onPress={() => router.push("/(tabs)/settings")}
            style={{ marginTop: 18 }}
          >
            <AppText variant="small" align="center" style={{ fontSize: 11 }}>
              Audit runs locally. Your passwords are never uploaded or analysed
              elsewhere.
            </AppText>
          </Pressable>
        </>
      )}
    </Screen>
  );
}
