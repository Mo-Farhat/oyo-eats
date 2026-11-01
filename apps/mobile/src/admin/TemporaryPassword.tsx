import type { CreatedAccount } from '@oyo/shared';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Text } from '@/components';
import { colors, fonts } from '@/theme/tokens';

/** The one-time password, shown once (ADM-08). Hand it over in person or read it out. */
export function TemporaryPassword({
  created,
  title,
  onDone,
}: {
  created: CreatedAccount;
  title: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Card tone="green">
      <Text variant="h3">{title}</Text>
      <View style={styles.row}>
        <Text variant="label">Username</Text>
        <Text style={styles.value} selectable>
          {created.username}
        </Text>
      </View>
      <View style={styles.row}>
        <Text variant="label">One-time password</Text>
        <Text style={styles.value} selectable>
          {created.temporaryPassword}
        </Text>
      </View>
      <Text variant="small">
        This is shown only once. They sign in with it on their own phone or tablet, then choose
        their own password. If it’s lost, reset the password.
      </Text>
      <Button
        variant="secondary"
        label={copied ? 'Copied' : 'Copy Both'}
        onPress={() => {
          void Clipboard.setStringAsync(
            `Username: ${created.username}\nPassword: ${created.temporaryPassword}`,
          ).then(() => setCopied(true));
        }}
      />
      <Button label="Done" onPress={onDone} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: 2 },
  value: { fontFamily: fonts.sans700, fontSize: 18, color: colors.strong, letterSpacing: 0.5 },
});
