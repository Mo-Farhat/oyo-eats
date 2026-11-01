import { can, type CreateAccountInput, type CreatedAccount } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { adminApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { ADMIN_ACCOUNTS, ADMIN_RESTAURANTS, useAdminRestaurants } from '@/admin/queries';
import { TemporaryPassword } from '@/admin/TemporaryPassword';
import { useSession } from '@/auth/session';
import { Alert, Button, Chip, IconButton, Screen, Segmented, Text, TextField } from '@/components';

type Kind = 'rider' | 'restaurant' | 'dispatcher';

/**
 * A10: create a login (ADM-08). Riders and restaurant logins: dispatchers and the owner;
 * dispatchers: the owner only. The one-time password is shown once.
 */
export default function NewAccount() {
  const params = useLocalSearchParams<{ role?: string; tenantId?: string; place?: string }>();
  const role = useSession((s) => s.session?.account.role);
  const owner = !!role && can(role, 'accounts.create_dispatcher');
  const queryClient = useQueryClient();
  const fixedTenant = params.tenantId;
  const [kind, setKind] = useState<Kind>(
    params.role === 'restaurant_owner' || params.role === 'restaurant_staff'
      ? 'restaurant'
      : 'rider',
  );
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState('Motorbike');
  const [plate, setPlate] = useState('');
  const [nic, setNic] = useState('');
  const [restaurantRole, setRestaurantRole] = useState<'restaurant_owner' | 'restaurant_staff'>(
    params.role === 'restaurant_staff' ? 'restaurant_staff' : 'restaurant_owner',
  );
  const restaurants = useAdminRestaurants(owner && kind === 'restaurant' && !fixedTenant);
  const [tenantId, setTenantId] = useState(fixedTenant);
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  const create = useMutation({
    mutationFn: adminApi.createAccount,
    onSuccess: (c) => {
      setCreated(c);
      void queryClient.invalidateQueries({ queryKey: ADMIN_ACCOUNTS });
      void queryClient.invalidateQueries({ queryKey: ADMIN_RESTAURANTS });
      if (tenantId)
        void queryClient.invalidateQueries({ queryKey: ['admin-restaurant', tenantId] });
    },
  });

  const submit = () => {
    const common = {
      displayName: name.trim(),
      username: username.trim().toLowerCase() || undefined,
      phone: phone.trim() ? `+94${phone.replace(/\D/g, '').replace(/^0/, '')}` : undefined,
    };
    let input: CreateAccountInput;
    if (kind === 'rider')
      input = {
        role: 'rider',
        ...common,
        phone: common.phone ?? '',
        vehicleType: vehicle.trim(),
        plate: plate.trim().toUpperCase(),
        nicNumber: nic.trim() || undefined,
      };
    else if (kind === 'restaurant')
      input = { role: restaurantRole, ...common, tenantId: tenantId! };
    else input = { role: 'dispatcher', ...common };
    create.mutate(input);
  };

  const kinds = [
    { value: 'rider' as const, label: 'Rider' },
    { value: 'restaurant' as const, label: 'Restaurant' },
    ...(owner ? [{ value: 'dispatcher' as const, label: 'Dispatcher' }] : []),
  ];
  const ready =
    name.trim().length >= 2 &&
    (kind !== 'rider' ||
      (vehicle.trim() && plate.trim() && phone.replace(/\D/g, '').length >= 9)) &&
    (kind !== 'restaurant' || tenantId);

  return (
    <Screen
      top={
        <>
          <IconButton icon="back" label="Back" onPress={() => router.back()} />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              New Login
            </Text>
            {params.place ? <Text variant="small">{`For ${params.place}`}</Text> : null}
          </View>
        </>
      }
      bodyStyle={{ gap: 14 }}
    >
      {created ? (
        <TemporaryPassword
          created={created}
          title={`Login created for ${name.trim()}`}
          onDone={() => router.back()}
        />
      ) : (
        <>
          {!fixedTenant ? <Segmented options={kinds} value={kind} onChange={setKind} /> : null}
          <TextField
            label={kind === 'restaurant' ? 'Person’s name' : 'Full name'}
            value={name}
            onChangeText={setName}
          />
          {kind === 'restaurant' ? (
            <>
              <Text variant="label">Role</Text>
              <View style={styles.chips}>
                {(
                  [
                    ['restaurant_owner', 'Owner (manages the restaurant)'],
                    ['restaurant_staff', 'Kitchen staff (orders only)'],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: restaurantRole === value }}
                    onPress={() => setRestaurantRole(value)}
                  >
                    <Chip label={label} tone={restaurantRole === value ? 'on' : 'neutral'} />
                  </Pressable>
                ))}
              </View>
              {!fixedTenant ? (
                owner ? (
                  <>
                    <Text variant="label">Restaurant</Text>
                    <View style={styles.chips}>
                      {(restaurants.data ?? []).map((r) => (
                        <Pressable
                          key={r.id}
                          accessibilityRole="radio"
                          accessibilityState={{ checked: tenantId === r.id }}
                          onPress={() => setTenantId(r.id)}
                        >
                          <Chip label={r.name} tone={tenantId === r.id ? 'on' : 'neutral'} />
                        </Pressable>
                      ))}
                    </View>
                  </>
                ) : (
                  <Alert
                    tone="info"
                    message="Open the restaurant from the owner’s Restaurants tab to add its logins."
                  />
                )
              ) : null}
            </>
          ) : null}
          {kind === 'rider' ? (
            <>
              <TextField label="Vehicle" value={vehicle} onChangeText={setVehicle} />
              <TextField
                label="Number plate"
                value={plate}
                onChangeText={setPlate}
                autoCapitalize="characters"
              />
              <TextField
                label="NIC number (optional)"
                hint="Stored encrypted."
                value={nic}
                onChangeText={setNic}
                autoCapitalize="characters"
              />
            </>
          ) : null}
          <TextField
            label={kind === 'rider' ? 'Mobile' : 'Mobile (optional)'}
            hint={
              kind === 'rider' ? 'Customers call the rider on this during a delivery.' : undefined
            }
            prefix="+94"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <TextField
            label="Username (optional)"
            hint="Leave blank to make one from the name."
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text variant="small">
            {kind === 'rider'
              ? 'The rider signs in on their own phone. That phone is then the only one allowed; a new phone needs your approval.'
              : kind === 'restaurant'
                ? restaurantRole === 'restaurant_owner'
                  ? 'Owners set up two-step sign-in with an authenticator app on first sign-in.'
                  : 'Staff sign in on the kitchen tablet. A new device needs approval.'
                : 'Dispatchers set up two-step sign-in with an authenticator app on first sign-in.'}
          </Text>
          {create.error ? <Alert tone="danger" message={errorMessage(create.error)} /> : null}
          <Button
            label="Create Login"
            disabled={!ready}
            loading={create.isPending}
            onPress={submit}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
