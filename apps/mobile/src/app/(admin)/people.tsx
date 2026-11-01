import { can, type CreatedAccount, type Role, type StaffAccount } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { adminApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { ADMIN_ACCOUNTS, useAccounts } from '@/admin/queries';
import { TemporaryPassword } from '@/admin/TemporaryPassword';
import { useSession } from '@/auth/session';
import {
  Alert,
  Button,
  Card,
  Chip,
  ConfirmSheet,
  IconButton,
  Screen,
  Segmented,
  Text,
} from '@/components';

type Tab = 'rider' | 'restaurant' | 'dispatcher';
const ROLES: Record<Tab, Role[]> = {
  rider: ['rider'],
  restaurant: ['restaurant_owner', 'restaurant_staff'],
  dispatcher: ['dispatcher'],
};
const ROLE_LABEL: Partial<Record<Role, string>> = {
  rider: 'Rider',
  restaurant_owner: 'Restaurant owner',
  restaurant_staff: 'Kitchen staff',
  dispatcher: 'Dispatcher',
};
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 60
    ? `${m} min ago`
    : m < 1440
      ? `${Math.round(m / 60)} h ago`
      : `${Math.round(m / 1440)} d ago`;
};

/**
 * Logins and devices (from More): riders, restaurant logins and dispatchers. New logins, password resets,
 * switching accounts off, and approving a new phone or tablet (ADM-08, ADM-19, SEC-06).
 */
export default function People() {
  const role = useSession((s) => s.session?.account.role);
  const owner = !!role && can(role, 'staff.manage');
  const [tab, setTab] = useState<Tab>('rider');
  const accounts = useAccounts();
  const queryClient = useQueryClient();
  const [issued, setIssued] = useState<{ created: CreatedAccount; name: string } | null>(null);
  const [switchOff, setSwitchOff] = useState<StaffAccount | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ADMIN_ACCOUNTS });
  const device = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) => adminApi.decideDevice(v.id, v.approve),
    onSuccess: refresh,
  });
  const active = useMutation({
    mutationFn: (v: { id: string; active: boolean }) => adminApi.setActive(v.id, v.active),
    onSuccess: () => {
      setSwitchOff(null);
      refresh();
    },
  });
  const reset = useMutation({ mutationFn: adminApi.resetPassword });

  const all = accounts.data ?? [];
  const waiting = all.filter((a) => a.pendingDevices.length);
  const rows = all.filter((a) => ROLES[tab].includes(a.role));
  const tabs = [
    { value: 'rider' as const, label: 'Riders' },
    { value: 'restaurant' as const, label: 'Restaurants' },
    ...(owner ? [{ value: 'dispatcher' as const, label: 'Office' }] : []),
  ];
  const error = accounts.error ?? device.error ?? active.error ?? reset.error;

  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              Logins and Devices
            </Text>
          </View>
          <Button small label="New Login" onPress={() => router.push('/account-new')} />
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
      {issued ? (
        <TemporaryPassword
          created={issued.created}
          title={`New password for ${issued.name}`}
          onDone={() => setIssued(null)}
        />
      ) : null}

      {waiting.length ? (
        <Card tone="warn">
          <Text variant="strong">New devices waiting</Text>
          <Text variant="small">
            Approve only if the person told you they changed phone or tablet.
          </Text>
          {waiting.flatMap((a) =>
            a.pendingDevices.map((d) => (
              <View key={d.id} style={styles.device}>
                <View style={{ flex: 1 }}>
                  <Text variant="strong">{a.displayName}</Text>
                  <Text variant="small">{`${ROLE_LABEL[a.role] ?? a.role} · ${d.platform ?? 'device'} · tried ${ago(d.firstSeenAt)}`}</Text>
                </View>
                <Button
                  small
                  variant="secondary"
                  label="Reject"
                  onPress={() => device.mutate({ id: d.id, approve: false })}
                />
                <Button
                  small
                  label="Approve"
                  onPress={() => device.mutate({ id: d.id, approve: true })}
                />
              </View>
            )),
          )}
        </Card>
      ) : null}

      <Segmented options={tabs} value={tab} onChange={setTab} />
      {accounts.data && rows.length === 0 ? <Text variant="muted">No logins here yet.</Text> : null}
      {rows.map((a) => (
        <Card key={a.id} style={!a.active ? { opacity: 0.6 } : undefined}>
          <View style={styles.between}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="strong">{a.displayName}</Text>
              <Text variant="small">
                {[ROLE_LABEL[a.role], a.username].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Chip
              label={a.active ? 'Active' : 'Switched off'}
              tone={a.active ? 'green' : 'neutral'}
            />
          </View>
          <View style={styles.actions}>
            <Button
              small
              variant="secondary"
              label="Reset Password"
              loading={reset.isPending && reset.variables === a.id}
              onPress={() =>
                reset.mutate(a.id, {
                  onSuccess: (created) => setIssued({ created, name: a.displayName }),
                })
              }
            />
            {a.active ? (
              <Button small variant="ghost" label="Switch Off" onPress={() => setSwitchOff(a)} />
            ) : (
              <Button
                small
                variant="ghost"
                label="Switch On"
                onPress={() => active.mutate({ id: a.id, active: true })}
              />
            )}
          </View>
        </Card>
      ))}

      <ConfirmSheet
        visible={!!switchOff}
        title={`Switch off ${switchOff?.displayName ?? ''}?`}
        message="They’re signed out everywhere at once and can’t sign in until you switch them back on."
        confirmLabel="Switch Off"
        danger
        loading={active.isPending}
        onConfirm={() => active.mutate({ id: switchOff!.id, active: false })}
        onCancel={() => setSwitchOff(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  device: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
