import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { AuthShell } from "@/components/auth/AuthShell";
import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Callout } from "@/components/ui/Callout";
import { Field } from "@/components/ui/Field";
import { StrengthBar } from "@/components/ui/StrengthBar";
import { useVault } from "@/lib/state/vault-provider";
import { useAppTheme } from "@/lib/theme";
import { passwordStrength } from "@/lib/vault/generator";

export default function CreateVaultScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const { createVault, legacyCount } = useVault();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = passwordStrength(password);
  const matches = confirm.length === 0 || confirm === password;

  const submit = async () => {
    setError(null);
    if (password.length < 10) {
      setError("Use at least 10 characters. Longer is stronger.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await createVault(password);
    } catch (caught) {
      setError((caught as Error).message);
      setLoading(false);
    }
  };

  return (
    <AuthShell back keyboard>
      <AppText variant="display" style={{ fontSize: 42, lineHeight: 44 }}>
        Create your{"\n"}vault.
      </AppText>
      <AppText variant="small" style={{ marginTop: 12, maxWidth: 330 }}>
        One master password protects everything. It is stretched locally with
        210,000 PBKDF2 rounds and never leaves this device.
      </AppText>

      <View style={{ marginTop: 26, gap: 16 }}>
        <Field
          label="MASTER PASSWORD"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setError(null);
          }}
          placeholder="At least 10 characters"
          secure
          autoFocus
          autoComplete="new-password"
          textContentType="newPassword"
          hint={password.length > 0 ? undefined : "Tip: four random words beat one clever word."}
        />
        {password.length > 0 ? (
          <StrengthBar
            score={strength.score}
            fraction={strength.fraction}
            label={strength.label}
          />
        ) : null}

        <Field
          label="CONFIRM PASSWORD"
          value={confirm}
          onChangeText={(value) => {
            setConfirm(value);
            setError(null);
          }}
          placeholder="Type it again"
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          error={matches ? null : "Passwords do not match yet."}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </View>

      {legacyCount > 0 ? (
        <Callout
          tone="info"
          title="Import ready"
          body={`${legacyCount} existing authenticator${legacyCount === 1 ? "" : "s"} will be moved into this vault.`}
          style={{ marginTop: 18 }}
        />
      ) : null}

      <Callout
        tone="warning"
        title="There is no reset"
        body="If you forget this password, the vault cannot be recovered — not by us, and not by your server."
        style={{ marginTop: 18 }}
      />

      {error ? (
        <AppText variant="small" color={theme.colors.danger} style={{ marginTop: 14 }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ marginTop: 22, gap: 10 }}>
        <Button
          label="Create encrypted vault"
          icon="shield"
          onPress={submit}
          loading={loading}
          disabled={password.length === 0 || confirm.length === 0}
        />
        <Button
          label="Use a different path"
          variant="ghost"
          onPress={() => router.back()}
        />
      </View>
    </AuthShell>
  );
}
