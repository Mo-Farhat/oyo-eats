import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  Button,
  IconButton,
  MapPlaceholder,
  Radio,
  Screen,
  Segmented,
  Text,
  TextField,
} from '@/components';
import { PILOT_TOWN } from '@/config';
import { keys, useAddresses } from '@/customer/queries';
import { useCustomer } from '@/customer/store';
import { colors } from '@/theme/tokens';

const LABELS = [
  { value: 'Home', label: 'Home' },
  { value: 'Work', label: 'Work' },
  { value: 'Other', label: 'Other' },
] as const;

/**
 * C01: choose a saved address or add one. The pin comes from GPS; the draggable map and street
 * search arrive with the Google Maps key (docs/NEEDS-YOU.md).
 */
export default function LocationScreen() {
  const queryClient = useQueryClient();
  const addresses = useAddresses();
  const selected = useCustomer((s) => s.addressId);
  const setAddress = useCustomer((s) => s.setAddress);

  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string>();
  const [street, setStreet] = useState('');
  const [house, setHouse] = useState('');
  const [landmark, setLandmark] = useState('');
  const [label, setLabel] = useState<(typeof LABELS)[number]['value']>('Home');

  const done = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const locate = async () => {
    setLocating(true);
    setLocateError(undefined);
    try {
      // Asked in context, with the reason in app.json (PRI-03).
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocateError(
          'Location is off for Oyo Eats. You can still type your address; the pin stays at the town centre.',
        );
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      setLocateError("Couldn't get your location. Try again outside or near a window.");
    } finally {
      setLocating(false);
    }
  };

  const save = useMutation({
    mutationFn: () =>
      customerApi.addAddress({
        label,
        lat: (point ?? PILOT_TOWN).lat,
        lng: (point ?? PILOT_TOWN).lng,
        addressText: [house.trim(), street.trim()].filter(Boolean).join(', '),
        note: landmark.trim() || undefined,
      }),
    onSuccess: async (address) => {
      setAddress(address.id);
      await queryClient.invalidateQueries({ queryKey: keys.addresses });
      done();
    },
  });

  const saved = addresses.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <MapPlaceholder height={260}>
        <SafeAreaView edges={['top']} style={styles.overlayTop}>
          {router.canGoBack() ? (
            <IconButton icon="back" label="Back" onPress={() => router.back()} />
          ) : null}
        </SafeAreaView>
        <View style={styles.locate}>
          <IconButton
            icon="locate"
            label="Use my location"
            onPress={() => void locate()}
            green={!!point}
          />
        </View>
      </MapPlaceholder>
      <Screen background={colors.page} bodyStyle={{ gap: 14, paddingTop: 20 }}>
        <View style={{ gap: 4 }}>
          <Text variant="h2" accessibilityRole="header">
            Where Should We Deliver?
          </Text>
          <Text variant="muted">
            {point
              ? `Pin set from your location (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}).`
              : locating
                ? 'Finding you…'
                : `Tap the arrow to use your location. Until then the pin is at ${PILOT_TOWN.name} town centre.`}
          </Text>
        </View>
        {locateError ? <Alert message={locateError} /> : null}

        {saved.length ? (
          <View>
            <Text variant="label">Saved addresses</Text>
            {saved.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: a.id === selected }}
                onPress={() => {
                  setAddress(a.id);
                  done();
                }}
                style={styles.saved}
              >
                <Radio on={a.id === (selected ?? saved[0]?.id)} />
                <View style={{ flex: 1 }}>
                  <Text variant="strong">{a.label}</Text>
                  <Text variant="small" numberOfLines={1}>
                    {a.addressText}
                  </Text>
                </View>
              </Pressable>
            ))}
            <Text variant="label" style={{ marginTop: 16 }}>
              Add a new address
            </Text>
          </View>
        ) : null}

        <TextField
          label="Street and area"
          value={street}
          onChangeText={setStreet}
          placeholder="42 Ambagamuwa Road"
        />
        <TextField
          label="House no. / apartment"
          value={house}
          onChangeText={setHouse}
          placeholder="No. 42, upstairs"
        />
        <TextField
          label="Landmark for the rider"
          value={landmark}
          onChangeText={setLandmark}
          placeholder="Green gate opposite the Dialog tower"
        />
        <Segmented options={LABELS} value={label} onChange={setLabel} />
        {!point ? (
          <Alert
            tone="info"
            message="Without your location the delivery fee is estimated from the town centre."
          />
        ) : null}
        {save.error ? <Alert tone="danger" message={errorMessage(save.error)} /> : null}
        <Button
          label="Confirm Location"
          onPress={() => save.mutate()}
          loading={save.isPending}
          disabled={street.trim().length < 3}
        />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayTop: { position: 'absolute', top: 0, left: 20, paddingTop: 20 },
  locate: { position: 'absolute', right: 20, bottom: 20 },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
