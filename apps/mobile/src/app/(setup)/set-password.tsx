import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { authApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { useSession } from '@/auth/session';
import { signOut } from '@/auth/sign-out';
import { Alert, Button, Card, Checkbox, Chip, Screen, Spacer, Text, TextField } from '@/components';

const MIN_LENGTH = 10; // SEC-02

/** S05: first sign-in (or after an admin reset) must replace the temporary password. */
export default function SetPassword() {
  const name = useSession((s) => s.session?.account.displayName);
  const remembered = useSession((s) => s.temporaryPassword);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const longEnough = next.length >= MIN_LENGTH;
  const matches = next.length > 0 && next === confirm;
  const temporary = remembered ?? current;

  const save = useMutation({
    mutationFn: () => authApi.changePassword(temporary, next),
    onSuccess: async (result) => {
      await useSession.getState().signIn(result);
      router.replace('/');
    },
  });

  return (
    <Screen top={<Chip tone="green" label="First login" />} bodyStyle={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Text variant="h1" accessibilityRole="header">
          Set Your Own Password
        </Text>
        <Text variant="lede">
          {name ? `Hi ${name.split(' ')[0]}, your` : 'Your'} admin gave you a temporary password.
          Choose one only you know.
        </Text>
      </View>
      {remembered ? null : (
        <TextField
          label="Temporary password"
          secret
          value={current}
          onChangeText={setCurrent}
          autoComplete="current-password"
        />
      )}
      <TextField
        label="New password"
        secret
        value={next}
        onChangeText={setNext}
        textContentType="newPassword"
        autoComplete="new-password"
      />
      <TextField
        label="Confirm password"
        secret
        value={confirm}
        onChangeText={setConfirm}
        textContentType="newPassword"
      />
      <Card style={{ gap: 8 }}>
        <Checkbox checked={longEnough} label={`At least ${MIN_LENGTH} characters`}>
          <Text>At least {MIN_LENGTH} characters</Text>
        </Checkbox>
        <Checkbox checked={matches} label="Both fields match">
          <Text>Both fields match</Text>
        </Checkbox>
      </Card>
      {save.error ? <Alert tone="danger" message={errorMessage(save.error)} /> : null}
      <Spacer />
      <Text variant="small">
        Also shown after an admin resets your password. You can't skip this step.
      </Text>
      <Button
        label="Save & Continue"
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!longEnough || !matches || temporary.length === 0}
      />
      <Button variant="ghost" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}
