import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { useSession } from '@/auth/session';
import { signOut } from '@/auth/sign-out';
import {
  Alert,
  Button,
  Card,
  ConfirmSheet,
  Icon,
  IconButton,
  Screen,
  Sheet,
  Text,
  TextField,
  Toggle,
} from '@/components';
import { keys, useAddresses } from '@/customer/queries';
import { useCustomer } from '@/customer/store';
import { call } from '@/call';
import { OFFICE_PHONE } from '@/config';
import { colors, fonts } from '@/theme/tokens';

const PROFILE = ['profile'] as const;

const display = (e164: string) =>
  e164 ? `+94 ${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}` : '';
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** C15: who you are, addresses, offers, help, sign out, delete account (CUS-18). */
export default function Profile() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: PROFILE, queryFn: customerApi.profile });
  const addresses = useAddresses();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const p = profile.data;

  const update = useMutation({
    mutationFn: customerApi.updateProfile,
    onSuccess: (next) => {
      queryClient.setQueryData(PROFILE, next);
      setEditing(false);
    },
  });
  const removeAddress = useMutation({
    mutationFn: customerApi.deleteAddress,
    onSuccess: (_, id) => {
      if (useCustomer.getState().addressId === id) useCustomer.getState().setAddress(null);
      void queryClient.invalidateQueries({ queryKey: keys.addresses });
    },
  });
  const remove = useMutation({
    mutationFn: customerApi.deleteAccount,
    onSuccess: async () => {
      useCustomer.getState().clear();
      useCustomer.getState().setAddress(null);
      await useSession.getState().signOut();
    },
  });

  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Profile
      </Text>
      {profile.error ? <Alert tone="danger" message={errorMessage(profile.error)} /> : null}

      <Card style={styles.who}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(p?.displayName ?? '')}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="h3">{p?.displayName || 'Add your name'}</Text>
          <Text variant="small">{display(p?.phone ?? '')}</Text>
        </View>
        <Button
          variant="ghost"
          label="Edit"
          onPress={() => {
            setName(p?.displayName ?? '');
            setEditing(true);
          }}
        />
      </Card>

      <Card style={styles.list}>
        <Text variant="label" style={{ paddingTop: 10 }}>
          Saved addresses
        </Text>
        {addresses.data?.map((a) => (
          <View key={a.id} style={styles.row}>
            <Icon name={a.label === 'Home' ? 'home' : 'pin'} />
            <View style={{ flex: 1 }}>
              <Text variant="strong">{a.label}</Text>
              <Text variant="small" numberOfLines={1}>
                {a.addressText}
              </Text>
            </View>
            <IconButton
              icon="close"
              label={`Remove ${a.label} address`}
              onPress={() => removeAddress.mutate(a.id)}
            />
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/location')}
          style={[styles.row, { borderBottomWidth: 0 }]}
        >
          <Icon name="plus" color={colors.brandSoft} />
          <Text style={styles.green}>Add address</Text>
        </Pressable>
      </Card>

      <Card style={styles.list}>
        <View style={styles.row}>
          <Icon name="bell" />
          <View style={{ flex: 1 }}>
            <Text variant="strong">Offers and news</Text>
            <Text variant="small">Order updates always come through.</Text>
          </View>
          <Toggle
            label="Offers and news"
            value={p?.marketingOptIn ?? false}
            onChange={(v) => update.mutate({ marketingOptIn: v })}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => call(OFFICE_PHONE.e164)}
          style={styles.row}
        >
          <Icon name="user" />
          <Text variant="strong" style={{ flex: 1 }}>
            {`Help · Call ${OFFICE_PHONE.display}`}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.row}>
          <Icon name="logout" />
          <Text variant="strong" style={{ flex: 1 }}>
            Log out
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setDeleting(true)}
          style={[styles.row, { borderBottomWidth: 0 }]}
        >
          <Icon name="close" color={colors.danger} />
          <Text style={[styles.strongText, { color: colors.danger }]}>Delete account</Text>
        </Pressable>
      </Card>
      <Text variant="small">Delete is blocked while an order is active.</Text>
      {update.error ? <Alert tone="danger" message={errorMessage(update.error)} /> : null}

      <Sheet visible={editing} onClose={() => setEditing(false)}>
        <Text variant="h2">Your Details</Text>
        <TextField
          label="Name"
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
        />
        <Button
          label="Save"
          loading={update.isPending}
          disabled={!name.trim()}
          onPress={() => update.mutate({ displayName: name.trim() })}
        />
        <Button
          variant="secondary"
          label="Change Phone Number"
          onPress={() => {
            setEditing(false);
            router.push('/phone');
          }}
        />
      </Sheet>

      <ConfirmSheet
        visible={deleting}
        title="Delete Your Account?"
        message={
          p?.hasOpenOrders
            ? 'You have an order in progress. You can delete your account once it is finished.'
            : 'Your name, number and addresses are removed now. Past orders stay in our records without your details. This can’t be undone.'
        }
        confirmLabel="Delete Account"
        danger
        loading={remove.isPending}
        onConfirm={() => (p?.hasOpenOrders ? setDeleting(false) : remove.mutate())}
        onCancel={() => setDeleting(false)}
      />
      {remove.error ? <Alert tone="danger" message={errorMessage(remove.error)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 9999,
    backgroundColor: '#2d333c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display700, fontSize: 18, color: colors.strong },
  list: { gap: 0, paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: 52,
  },
  green: { fontFamily: fonts.sans600, fontSize: 14, color: colors.brandSoft },
  strongText: { fontFamily: fonts.sans600, fontSize: 14, flex: 1 },
});
