import type { CreatedAccount, StaffAccount } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { TemporaryPassword } from '@/admin/TemporaryPassword';
import {
  Alert,
  Button,
  Card,
  Chip,
  ConfirmSheet,
  IconButton,
  Screen,
  Sheet,
  Text,
  TextField,
} from '@/components';

const KEY = ['restaurant-staff'];

/** T12 (RES-01): the owner adds and removes kitchen logins, resets passwords, approves a tablet. */
export default function KitchenStaff() {
  const queryClient = useQueryClient();
  const staff = useQuery({ queryKey: KEY, queryFn: restaurantApi.staff });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [issued, setIssued] = useState<{ created: CreatedAccount; title: string } | null>(null);
  const [off, setOff] = useState<StaffAccount | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const add = useMutation({
    mutationFn: () => restaurantApi.addStaff({ displayName: name.trim() }),
    onSuccess: (c) => {
      setIssued({ created: c, title: `Login for ${name.trim()}` });
      setAdding(false);
      setName('');
      refresh();
    },
  });
  const reset = useMutation({
    mutationFn: (a: StaffAccount) => restaurantApi.resetStaff(a.id),
    onSuccess: (c, a) => setIssued({ created: c, title: `New password for ${a.displayName}` }),
  });
  const active = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      restaurantApi.setStaffActive(v.id, v.active),
    onSuccess: () => {
      setOff(null);
      refresh();
    },
  });
  const device = useMutation({
    mutationFn: (v: { id: string; approve: boolean }) =>
      restaurantApi.decideStaffDevice(v.id, v.approve),
    onSuccess: refresh,
  });
  const error = staff.error ?? reset.error ?? active.error ?? device.error;
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Staff
          </Text>
          <Button small label="Add" onPress={() => setAdding(true)} />
        </>
      }
      bodyStyle={{ gap: 10 }}
    >
      {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
      {issued ? (
        <TemporaryPassword
          created={issued.created}
          title={issued.title}
          onDone={() => setIssued(null)}
        />
      ) : null}
      {staff.data?.map((a) => (
        <Card key={a.id} style={{ gap: 6, opacity: a.active ? 1 : 0.6 }}>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="strong">{a.displayName}</Text>
              <Text variant="small">{`${a.role === 'restaurant_owner' ? 'Owner' : 'Kitchen staff'} · ${a.username ?? ''}`}</Text>
            </View>
            <Chip
              label={a.active ? 'Active' : 'Switched off'}
              tone={a.active ? 'green' : 'neutral'}
            />
          </View>
          {a.pendingDevices.map((d) => (
            <View key={d.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text variant="small" style={{ flex: 1 }}>
                New tablet or phone waiting
              </Text>
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
          ))}
          {a.role === 'restaurant_staff' ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                small
                variant="secondary"
                label="Reset Password"
                onPress={() => reset.mutate(a)}
              />
              {a.active ? (
                <Button small variant="ghost" label="Switch Off" onPress={() => setOff(a)} />
              ) : (
                <Button
                  small
                  variant="ghost"
                  label="Switch On"
                  onPress={() => active.mutate({ id: a.id, active: true })}
                />
              )}
            </View>
          ) : null}
        </Card>
      ))}
      <Text variant="small">Owner logins are managed by Oyo Eats.</Text>
      <Sheet
        visible={adding}
        onClose={() => setAdding(false)}
        footer={
          <Button
            label="Create Login"
            disabled={name.trim().length < 2}
            loading={add.isPending}
            onPress={() => add.mutate()}
          />
        }
      >
        <Text variant="h2">Add kitchen staff</Text>
        <Text variant="muted">
          They can take and prepare orders and edit the menu, but not see payouts or staff.
        </Text>
        <TextField label="Name" value={name} onChangeText={setName} />
        {add.error ? <Alert tone="danger" message={errorMessage(add.error)} /> : null}
      </Sheet>
      <ConfirmSheet
        visible={!!off}
        title={`Switch off ${off?.displayName ?? ''}?`}
        message="They are signed out at once and can't sign in until you switch them back on."
        confirmLabel="Switch Off"
        danger
        loading={active.isPending}
        onConfirm={() => active.mutate({ id: off!.id, active: false })}
        onCancel={() => setOff(null)}
      />
    </Screen>
  );
}
