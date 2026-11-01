import { useMutation, useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { authApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { useSession } from '@/auth/session';
import { signOut } from '@/auth/sign-out';
import { Alert, Button, Card, Chip, Icon, Screen, Spacer, Text, TextField } from '@/components';
import { colors, fonts } from '@/theme/tokens';

/**
 * Two-factor set-up for owner, dispatcher and restaurant owner (SEC-03). Not in the design
 * canvas; built in its style (docs/NEEDS-YOU.md).
 */
export default function EnrollTwoFactor() {
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  // A new secret each time this screen mounts; only the last confirmed one is kept.
  const setup = useQuery({
    queryKey: ['totp-setup'],
    queryFn: authApi.startTotp,
    staleTime: Infinity,
    gcTime: 0,
  });

  const confirm = useMutation({
    mutationFn: () => authApi.confirmTotp(code),
    onSuccess: async (result) => {
      await useSession.getState().signIn(result);
      router.replace('/');
    },
    onError: () => setCode(''),
  });

  const secret = setup.data?.secret ?? '';
  const grouped = secret.match(/.{1,4}/g)?.join(' ') ?? '';

  return (
    <Screen top={<Chip tone="green" label="Account security" />} bodyStyle={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Text variant="h1" accessibilityRole="header">
          Secure Your Account
        </Text>
        <Text variant="lede">
          Your account can move money and see customer details, so it needs a code from an
          authenticator app at every sign-in.
        </Text>
      </View>

      <Card style={{ gap: 10 }}>
        <Text variant="strong">1. Add Oyo Eats to your authenticator app</Text>
        <Text variant="muted">
          Use Google Authenticator, Microsoft Authenticator or any TOTP app.
        </Text>
        {setup.data ? (
          <>
            <Button
              variant="secondary"
              label="Open Authenticator App"
              onPress={() => void Linking.openURL(setup.data.otpauthUri)}
            />
            <Text variant="muted">Or enter this key by hand:</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy setup key"
              onPress={async () => {
                await Clipboard.setStringAsync(secret);
                setCopied(true);
              }}
              style={styles.secret}
            >
              <Text style={styles.secretText} selectable>
                {grouped}
              </Text>
              <Icon name={copied ? 'check' : 'copy'} size={18} color={colors.brandSoft} />
            </Pressable>
          </>
        ) : setup.error ? (
          <Alert tone="danger" message={errorMessage(setup.error)} />
        ) : (
          <Text variant="muted">Preparing your key…</Text>
        )}
      </Card>

      <View style={{ gap: 10 }}>
        <Text variant="strong">2. Enter the 6-digit code it shows</Text>
        <TextField
          label="Code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          maxLength={6}
        />
      </View>
      {confirm.error ? <Alert tone="danger" message={errorMessage(confirm.error)} /> : null}
      <Spacer />
      <Button
        label="Turn On & Continue"
        onPress={() => confirm.mutate()}
        loading={confirm.isPending}
        disabled={code.length !== 6 || !setup.data}
      />
      <Button variant="ghost" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  secret: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: colors.bar,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.control,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  secretText: {
    flex: 1,
    color: colors.strong,
    fontFamily: fonts.display600,
    fontSize: 15,
    letterSpacing: 1,
  },
});
