import type { AdminRestaurantDetail, RestaurantInput } from '@oyo/shared';
import * as Location from 'expo-location';
import { useState } from 'react';
import { View } from 'react-native';
import { Alert, Button, Text, TextField } from '@/components';
import { PILOT_TOWN } from '@/config';

const blank = (s: string) => (s.trim() ? s.trim() : undefined);

/**
 * Restaurant profile, licence and payout bank details (ADM-11). Used to add a restaurant and to
 * edit one. The pin comes from the phone's location on site, or coordinates pasted from Maps,
 * until the Google map picker is in (NEEDS-YOU).
 */
export function RestaurantForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
}: {
  initial?: AdminRestaurantDetail;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: RestaurantInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.addressText ?? '');
  const [coords, setCoords] = useState(
    initial ? `${initial.lat.toFixed(6)}, ${initial.lng.toFixed(6)}` : '',
  );
  const [cuisines, setCuisines] = useState(initial?.cuisines.join(', ') ?? '');
  const [prep, setPrep] = useState(String(initial?.prepMinutes ?? 20));
  const [licence, setLicence] = useState(initial?.licenceNumber ?? '');
  const [expiry, setExpiry] = useState(initial?.licenceExpiresOn ?? '');
  const [bank, setBank] = useState({
    bankName: initial?.bankDetails?.bankName ?? '',
    branch: initial?.bankDetails?.branch ?? '',
    accountName: initial?.bankDetails?.accountName ?? '',
    accountNumber: initial?.bankDetails?.accountNumber ?? '',
  });
  const [problem, setProblem] = useState<string>();
  const [locating, setLocating] = useState(false);

  const locate = async () => {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setProblem('Location is off. Paste the coordinates from Google Maps instead.');
        return;
      }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCoords(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
    } finally {
      setLocating(false);
    }
  };

  const submit = () => {
    const m = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return setProblem('Enter the pin as "latitude, longitude", e.g. 7.0430, 80.5340.');
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry.trim()))
      return setProblem('Enter the licence expiry as YYYY-MM-DD.');
    const bankFilled = Object.values(bank).some((v) => v.trim());
    if (bankFilled && !Object.values(bank).every((v) => v.trim()))
      return setProblem('Fill in all four bank fields, or leave them all empty.');
    setProblem(undefined);
    onSubmit({
      name: name.trim(),
      addressText: address.trim(),
      lat: Number(m[1]),
      lng: Number(m[2]),
      cuisines: cuisines
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      prepMinutes: Number(prep) || 20,
      licenceNumber: blank(licence),
      licenceExpiresOn: blank(expiry),
      bankDetails: bankFilled
        ? {
            bankName: bank.bankName.trim(),
            branch: bank.branch.trim(),
            accountName: bank.accountName.trim(),
            accountNumber: bank.accountNumber.trim(),
          }
        : undefined,
    });
  };

  return (
    <View style={{ gap: 14 }}>
      <TextField label="Restaurant name" value={name} onChangeText={setName} />
      <TextField
        label="Address"
        hint="As a rider would find it: street, landmark."
        value={address}
        onChangeText={setAddress}
      />
      <TextField
        label="Pin (latitude, longitude)"
        hint={`Stand at the entrance and use your location, or paste from Google Maps. ${PILOT_TOWN.name} centre is ${PILOT_TOWN.lat}, ${PILOT_TOWN.lng}.`}
        value={coords}
        onChangeText={setCoords}
        autoCapitalize="none"
      />
      <Button
        variant="secondary"
        small
        label="Use My Location"
        loading={locating}
        onPress={() => void locate()}
      />
      <TextField
        label="Cuisines"
        hint="Comma separated, e.g. Kottu, Rice, Short eats."
        value={cuisines}
        onChangeText={setCuisines}
      />
      <TextField
        label="Typical prep time (minutes)"
        value={prep}
        onChangeText={setPrep}
        keyboardType="number-pad"
      />

      <Text variant="h3">Food-handling licence</Text>
      <TextField label="Licence number" value={licence} onChangeText={setLicence} />
      <TextField
        label="Expires on"
        hint="YYYY-MM-DD. Ordering stops automatically once it lapses."
        value={expiry}
        onChangeText={setExpiry}
        autoCapitalize="none"
      />

      <Text variant="h3">Payout bank account</Text>
      <Text variant="small">Stored encrypted. Used for the weekly settlement.</Text>
      <TextField
        label="Bank"
        value={bank.bankName}
        onChangeText={(v) => setBank({ ...bank, bankName: v })}
      />
      <TextField
        label="Branch"
        value={bank.branch}
        onChangeText={(v) => setBank({ ...bank, branch: v })}
      />
      <TextField
        label="Account name"
        value={bank.accountName}
        onChangeText={(v) => setBank({ ...bank, accountName: v })}
      />
      <TextField
        label="Account number"
        value={bank.accountNumber}
        onChangeText={(v) => setBank({ ...bank, accountNumber: v })}
        keyboardType="number-pad"
      />
      {problem ? <Alert tone="danger" message={problem} /> : null}
      <Button label={submitLabel} loading={busy} onPress={submit} />
    </View>
  );
}
