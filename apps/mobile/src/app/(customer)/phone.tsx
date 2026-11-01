import { normalizeSriLankanMobile } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, IconButton, Screen, Text, TextField } from '@/components';

/** Verified phone change (CUS-18): a code goes to the new number; it switches once confirmed. */
export default function ChangePhone() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string>();

  const request = useMutation({
    mutationFn: (e164: string) => customerApi.requestPhoneChange(e164),
    onSuccess: (_, e164) => setSentTo(e164),
  });
  const verify = useMutation({
    mutationFn: () => customerApi.verifyPhoneChange(sentTo!, code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      router.back();
    },
  });

  return (
    <Screen
      top={<IconButton icon="back" label="Back" onPress={() => router.back()} />}
      bodyStyle={{ gap: 20 }}
    >
      <View style={{ gap: 8 }}>
        <Text variant="h1" accessibilityRole="header">
          Change Phone Number
        </Text>
        <Text variant="lede">
          We'll text a code to the new number. Your number changes once you enter it.
        </Text>
      </View>
      <TextField
        label="New mobile number"
        prefix="+94"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        error={fieldError}
        editable={!sentTo}
      />
      {sentTo ? (
        <TextField
          label="6-digit code"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoFocus
        />
      ) : null}
      {request.error || verify.error ? (
        <Alert tone="danger" message={errorMessage(request.error ?? verify.error)} />
      ) : null}
      {sentTo ? (
        <Button
          label="Confirm New Number"
          onPress={() => verify.mutate()}
          loading={verify.isPending}
          disabled={code.length !== 6}
        />
      ) : (
        <Button
          label="Send Code"
          loading={request.isPending}
          onPress={() => {
            const e164 = normalizeSriLankanMobile(phone);
            if (!e164) return setFieldError('Enter a Sri Lankan mobile number, like 77 123 4567.');
            setFieldError(undefined);
            request.mutate(e164);
          }}
        />
      )}
    </Screen>
  );
}
