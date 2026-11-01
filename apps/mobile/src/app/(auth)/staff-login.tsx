import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiRequestError, authApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { useSession } from '@/auth/session';
import {
  Alert,
  Button,
  Card,
  Icon,
  IconButton,
  Screen,
  Spacer,
  Text,
  TextField,
  Wordmark,
} from '@/components';
import { call } from '@/call';
import { OFFICE_PHONE } from '@/config';
import { colors } from '@/theme/tokens';

/** S04: riders, restaurant users and the Oyo Eats team sign in with issued credentials. */
export default function StaffLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);

  const login = useMutation({
    mutationFn: () =>
      authApi.login({
        username: username.trim(),
        password,
        totpCode: needsTotp ? totpCode : undefined,
      }),
    onSuccess: async (result) => {
      await useSession.getState().signIn(result, password);
      router.replace('/');
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'totp_required') setNeedsTotp(true);
      if (error instanceof ApiRequestError && error.code === 'totp_invalid') setTotpCode('');
    },
  });

  const error =
    login.error && !(login.error instanceof ApiRequestError && login.error.code === 'totp_required')
      ? errorMessage(login.error)
      : undefined;
  const canSubmit =
    username.trim().length >= 3 && password.length > 0 && (!needsTotp || totpCode.length === 6);

  return (
    <Screen
      top={
        <>
          <IconButton icon="back" label="Back" onPress={() => router.back()} />
          <Wordmark size={20} />
        </>
      }
      bodyStyle={{ gap: 20 }}
    >
      <View style={{ gap: 8 }}>
        <Text variant="h1" accessibilityRole="header">
          Staff Login
        </Text>
        <Text variant="lede">
          For riders, restaurants and the Oyo Eats team. Use the details your admin gave you.
        </Text>
      </View>
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
        autoComplete="username"
        editable={!needsTotp}
      />
      <TextField
        label="Password"
        secret
        value={password}
        onChangeText={setPassword}
        textContentType="password"
        autoComplete="current-password"
        editable={!needsTotp}
        onSubmitEditing={() => canSubmit && login.mutate()}
      />
      {needsTotp ? (
        <TextField
          label="Code from your authenticator app"
          value={totpCode}
          onChangeText={(t) => setTotpCode(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoFocus
          maxLength={6}
          hint="Open your authenticator app and enter the 6-digit code for Oyo Eats."
        />
      ) : null}
      {error ? <Alert tone="danger" message={error} /> : null}
      <Button
        label="Sign In"
        onPress={() => login.mutate()}
        loading={login.isPending}
        disabled={!canSubmit}
      />
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="lock" size={16} color={colors.brandSoft} />
          <Text variant="strong">Forgot your password?</Text>
        </View>
        <Text variant="muted">
          {`Passwords are reset by the Oyo Eats office. Call ${OFFICE_PHONE.display} and they'll give you a new one.`}
        </Text>
        <Button
          small
          variant="secondary"
          label={`Call ${OFFICE_PHONE.display}`}
          onPress={() => call(OFFICE_PHONE.e164)}
        />
      </Card>
      <Spacer />
      <Text variant="small">5 wrong passwords lock the account for 15 minutes.</Text>
    </Screen>
  );
}
