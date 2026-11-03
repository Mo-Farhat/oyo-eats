import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { riderApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { signOut } from '@/auth/sign-out';
import { localPhone } from '@/call';
import { Alert, Button, Card, LinkRow, Screen, Text, TextField } from '@/components';
import { useNotifications } from '@/notifications/queries';
import { EmergencyButton } from '@/rider/EmergencyButton';

/** R13: the rider's details, emergency contact (RID-14), notifications and sign out. */
export default function RiderProfile() {
  const unread = useNotifications().data?.unread ?? 0;
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['rider-profile'], queryFn: riderApi.profile });
  const p = profile.data;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (p?.emergencyContact) {
      setName(p.emergencyContact.name);
      setPhone(p.emergencyContact.phone.replace(/^\+94/, '0'));
    }
  }, [p?.emergencyContact?.phone]);
  const save = useMutation({
    mutationFn: () => riderApi.setEmergencyContact(name.trim(), phone.trim()),
    onSuccess: (d) => {
      queryClient.setQueryData(['rider-profile'], d);
      setEditing(false);
    },
  });
  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Profile
      </Text>
      {profile.error ? <Alert tone="danger" message={errorMessage(profile.error)} /> : null}
      {p ? (
        <Card style={{ gap: 2 }}>
          <Text variant="strong">{p.name}</Text>
          <Text variant="small">
            {[p.username, p.phone ? localPhone(p.phone) : null].filter(Boolean).join(' · ')}
          </Text>
          <Text variant="small">{`${p.vehicle} · ${p.plate}`}</Text>
          <Text variant="small">To change your vehicle or number, call the office.</Text>
        </Card>
      ) : null}
      <Card style={{ gap: 8 }}>
        <Text variant="strong">Emergency contact</Text>
        {p?.emergencyContact && !editing ? (
          <>
            <Text variant="body">{`${p.emergencyContact.name} · ${localPhone(p.emergencyContact.phone)}`}</Text>
            <Text variant="small">They get an SMS with your location if you press Emergency.</Text>
            <Button small variant="ghost" label="Change" onPress={() => setEditing(true)} />
          </>
        ) : (
          <>
            <Text variant="small">Someone to text with your location if you press Emergency.</Text>
            <TextField label="Name" value={name} onChangeText={setName} />
            <TextField
              label="Mobile"
              prefix="+94"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            {save.error ? <Alert tone="danger" message={errorMessage(save.error)} /> : null}
            <Button
              small
              label="Save Contact"
              disabled={name.trim().length < 2 || phone.replace(/\D/g, '').length < 9}
              loading={save.isPending}
              onPress={() => save.mutate()}
            />
          </>
        )}
      </Card>
      <Card style={{ gap: 0, paddingVertical: 4 }}>
        <LinkRow
          icon="bell"
          label="Notifications"
          hint="Job offers and order updates"
          count={unread}
          href="/rider-inbox"
        />
      </Card>
      <EmergencyButton />
      <Button variant="secondary" label="Sign Out" onPress={() => void signOut()} />
    </Screen>
  );
}
