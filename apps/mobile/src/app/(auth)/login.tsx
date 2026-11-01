import { normalizeSriLankanMobile } from '@oyo/shared';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiRequestError, authApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Icon, Screen, Spacer, Text, TextField, Wordmark } from '@/components';
import { colors } from '@/theme/tokens';

/** S02: welcome and customer sign-in by mobile number. */
export default function Login() {
  const [phone, setPhone] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const request = useMutation({
    mutationFn: (e164: string) => authApi.requestOtp(e164),
    onSuccess: (_, e164) => router.push({ pathname: '/otp', params: { phone: e164 } }),
    onError: (error, e164) => {
      // A code was already sent moments ago: carry on to enter it.
      if (error instanceof ApiRequestError && error.code === 'otp_resend_too_soon') {
        router.push({
          pathname: '/otp',
          params: { phone: e164, wait: String(error.body.retryAfterSeconds ?? 30) },
        });
      }
    },
  });

  const submit = () => {
    const e164 = normalizeSriLankanMobile(phone);
    if (!e164) return setFieldError('Enter a Sri Lankan mobile number, like 77 123 4567.');
    setFieldError(undefined);
    request.mutate(e164);
  };

  const shownError =
    request.error &&
    !(request.error instanceof ApiRequestError && request.error.code === 'otp_resend_too_soon')
      ? errorMessage(request.error)
      : undefined;

  return (
    <Screen background="#161719" bodyStyle={styles.body}>
      <Wordmark />
      {/* Placeholder until the brand illustration arrives (docs/NEEDS-YOU.md). */}
      <View
        style={styles.hero}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name="scooter" size={44} color={colors.brandSoft} />
      </View>
      <View style={styles.headline}>
        <Text variant="h1" style={styles.title} accessibilityRole="header">
          Local Food,{' '}
          <Text variant="h1" style={[styles.title, { color: colors.brand }]}>
            To Your Doorstep.
          </Text>
        </Text>
        <Text variant="lede">
          Order from your favourite places in Nawalapitiya and track your rider live.
        </Text>
      </View>
      <TextField
        label="Mobile number"
        prefix="+94"
        placeholder="77 123 4567"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        value={phone}
        onChangeText={setPhone}
        onSubmitEditing={submit}
        error={fieldError}
        hint="We'll text you a 6-digit code."
      />
      {shownError ? <Alert tone="danger" message={shownError} /> : null}
      <Button label="Continue" onPress={submit} loading={request.isPending} />
      <Spacer />
      <View style={styles.staff}>
        <Text variant="muted">Rider, restaurant or staff?</Text>
        <Button variant="ghost" label="Staff Login" onPress={() => router.push('/staff-login')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 56, paddingHorizontal: 24, gap: 24 },
  hero: {
    height: 250,
    borderRadius: 24,
    backgroundColor: colors.photo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: { gap: 8 },
  title: { fontSize: 32, lineHeight: 40 },
  staff: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 16,
  },
});
