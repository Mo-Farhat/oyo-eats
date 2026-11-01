import { can } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { SLIPS, useAccounts } from '@/admin/queries';
import { useSession } from '@/auth/session';
import { signOut } from '@/auth/sign-out';
import { Button, Card, Chip, Icon, Screen, Text, type IconName } from '@/components';
import { colors } from '@/theme/tokens';

function Row({
  icon,
  label,
  hint,
  count,
  href,
}: {
  icon: IconName;
  label: string;
  hint: string;
  count?: number;
  href: Href;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} waiting` : label}
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <Icon name={icon} />
      <View style={{ flex: 1 }}>
        <Text variant="strong">{label}</Text>
        <Text variant="small">{hint}</Text>
      </View>
      {count ? <Chip tone="warn" label={String(count)} /> : null}
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** A21 (first pass): office tools, account and sign out. */
export default function More() {
  const account = useSession((s) => s.session?.account);
  const owner = !!account && can(account.role, 'settlements.manage');
  const accounts = useAccounts();
  const slips = useQuery({ queryKey: SLIPS, queryFn: dispatchApi.slips, refetchInterval: 15_000 });
  const devices = (accounts.data ?? []).reduce((n, a) => n + a.pendingDevices.length, 0);
  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        More
      </Text>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <Row
          icon="user"
          label="Logins and Devices"
          hint="New logins, password resets, new phones to approve"
          count={devices}
          href="/people"
        />
        {owner ? (
          <Row
            icon="cash"
            label="Settlements"
            hint="Weekly restaurant statements and rider payouts"
            href="/settlements"
          />
        ) : null}
        <Row
          icon="bank"
          label="Bank Slips"
          hint="Bank transfers waiting to be checked"
          count={slips.data?.length}
          href="/slips"
        />
      </Card>
      <Card>
        <Text variant="strong">{account?.displayName}</Text>
        <Text variant="muted">{account?.role === 'owner' ? 'Owner' : 'Dispatcher'}</Text>
      </Card>
      <Button variant="secondary" label="Sign Out" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
