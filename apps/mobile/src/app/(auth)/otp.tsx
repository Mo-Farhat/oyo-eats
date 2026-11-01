import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ApiRequestError, authApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { useSession } from '@/auth/session';
import { Alert, Button, Card, Checkbox, IconButton, Screen, Spacer, Text } from '@/components';
import { colors, fonts } from '@/theme/tokens';

const LENGTH = 6;

function display(e164: string) {
  const local = e164.replace('+94', '');
  return `+94 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
}

/** S03: enter the 6-digit code. New numbers also confirm the terms here. */
export default function Otp() {
  const params = useLocalSearchParams<{ phone: string; wait?: string }>();
  const phone = params.phone;
  const [code, setCode] = useState('');
  const [needsTerms, setNeedsTerms] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [wait, setWait] = useState(Number(params.wait ?? 30));
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const verify = useMutation({
    mutationFn: (vars: { code: string; acceptTerms?: boolean }) =>
      authApi.verifyOtp({ phone, ...vars }),
    onSuccess: async (result) => {
      await useSession.getState().signIn(result);
      router.replace('/');
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === 'terms_required') setNeedsTerms(true);
      else setCode('');
    },
  });

  const resend = useMutation({
    mutationFn: () => authApi.requestOtp(phone),
    onSuccess: (r) => {
      setWait(r.resendAfterSeconds);
      setCode('');
      verify.reset();
    },
  });

  const onChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, LENGTH);
    setCode(digits);
    // Submits itself on the 6th digit (S03), unless the terms still need a tick.
    if (digits.length === LENGTH && !needsTerms) verify.mutate({ code: digits });
  };

  const error =
    verify.error && !needsTerms
      ? errorMessage(verify.error)
      : resend.error
        ? errorMessage(resend.error)
        : undefined;
  const mm = Math.floor(wait / 60);
  const ss = String(wait % 60).padStart(2, '0');

  return (
    <Screen
      top={<IconButton icon="back" label="Back" onPress={() => router.back()} />}
      bodyStyle={{ gap: 24 }}
    >
      <View style={{ gap: 8 }}>
        <Text variant="h1" accessibilityRole="header">
          Enter Your Code
        </Text>
        <Text variant="lede">
          Sent to{' '}
          <Text style={{ color: colors.strong, fontFamily: fonts.sans700 }}>{display(phone)}</Text>.{' '}
          <Text
            style={{ color: colors.brandSoft }}
            onPress={() => router.back()}
            accessibilityRole="link"
          >
            Change number
          </Text>
        </Text>
      </View>

      <Pressable onPress={() => input.current?.focus()} accessible={false}>
        <View style={styles.boxes}>
          {Array.from({ length: LENGTH }, (_, i) => (
            <View
              key={i}
              style={[styles.box, i === Math.min(code.length, LENGTH - 1) && styles.boxOn]}
            >
              <Text style={styles.digit}>{code[i] ?? ''}</Text>
            </View>
          ))}
        </View>
        {/* One real input under the boxes, so paste and SMS autofill work. */}
        <TextInput
          ref={input}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={LENGTH}
          autoFocus
          accessibilityLabel="6-digit code"
          style={styles.hidden}
        />
      </Pressable>

      <View style={styles.between}>
        <Text variant="muted">Didn't get it?</Text>
        {wait > 0 ? (
          <Text variant="muted">
            Resend in{' '}
            <Text style={{ color: colors.strong, fontFamily: fonts.sans700 }}>{`${mm}:${ss}`}</Text>
          </Text>
        ) : (
          <Button
            variant="ghost"
            label="Resend code"
            loading={resend.isPending}
            onPress={() => resend.mutate()}
          />
        )}
      </View>

      {error ? <Alert tone="danger" message={error} /> : null}

      {needsTerms ? (
        <Card tone="green">
          <Text variant="strong">Welcome to Oyo Eats</Text>
          <Checkbox
            checked={accepted}
            onChange={setAccepted}
            label="I am 18 or older and agree to the Terms and Privacy Notice"
          >
            <Text style={{ flex: 1 }}>
              I'm 18 or older and agree to the Terms of Service and Privacy Notice.
            </Text>
          </Checkbox>
        </Card>
      ) : (
        <Card style={{ gap: 6 }}>
          <Text variant="strong">What happens next</Text>
          <Text variant="muted">
            The code submits itself on the 6th digit. 5 wrong tries lock the number for 15 minutes.
          </Text>
        </Card>
      )}

      <Spacer />
      <Button
        label={needsTerms ? 'Agree & Continue' : 'Verify'}
        loading={verify.isPending}
        disabled={code.length !== LENGTH || (needsTerms && !accepted)}
        onPress={() => verify.mutate({ code, acceptTerms: needsTerms ? accepted : undefined })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  box: {
    width: 48,
    height: 58,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.bar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { borderWidth: 2, borderColor: colors.brand },
  digit: { fontFamily: fonts.display700, fontSize: 24, color: colors.strong },
  hidden: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
});
