import { CASE_LABELS, RIDER_ISSUES } from '@oyo/shared';
import { useMutation } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { riderApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Chip, Sheet, Text, TextField } from '@/components';
import { call } from '@/call';
import { OFFICE_PHONE } from '@/config';

type Issue = (typeof RIDER_ISSUES)[number];

/** Where the rider is, if the phone will say (for the office, RID-14). */
async function here(): Promise<{ lat?: number; lng?: number }> {
  try {
    const p = await Location.getLastKnownPositionAsync();
    return p ? { lat: p.coords.latitude, lng: p.coords.longitude } : {};
  } catch {
    return {};
  }
}

/** R12 (RID-13, RID-14): report a problem on this job, or call for help. Alerts dispatch at once. */
export function IssueSheet({
  orderId,
  visible,
  onClose,
}: {
  orderId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [type, setType] = useState<Issue>('customer_unreachable');
  const [description, setDescription] = useState('');
  const [sent, setSent] = useState(false);
  const report = useMutation({
    mutationFn: async () =>
      riderApi.reportIssue(orderId, {
        type,
        description: description.trim() || undefined,
        ...(await here()),
      }),
    onSuccess: () => setSent(true),
  });
  const close = () => {
    setSent(false);
    setDescription('');
    onClose();
  };
  const urgent = type === 'emergency' || type === 'accident';
  return (
    <Sheet
      visible={visible}
      onClose={close}
      footer={
        sent ? (
          <Button label="Done" onPress={close} />
        ) : (
          <View style={{ gap: 10 }}>
            <Button
              variant={urgent ? 'danger' : 'primary'}
              label={urgent ? 'Send Emergency Alert' : 'Tell Dispatch'}
              loading={report.isPending}
              onPress={() => report.mutate()}
            />
            <Button
              variant="secondary"
              label={`Call the Office ${OFFICE_PHONE.display}`}
              onPress={() => call(OFFICE_PHONE.e164)}
            />
          </View>
        )
      }
    >
      <Text variant="h2">{sent ? 'Dispatch has been told' : 'Report an issue'}</Text>
      {sent ? (
        <Text variant="muted">
          {urgent
            ? 'Every dispatcher got an alert with your location. Stay safe; they will call you.'
            : 'Dispatch will call you or sort it out. Keep the order with you until they do.'}
        </Text>
      ) : (
        <>
          <View style={styles.chips}>
            {RIDER_ISSUES.map((i) => (
              <Pressable
                key={i}
                accessibilityRole="radio"
                accessibilityState={{ checked: i === type }}
                onPress={() => setType(i)}
              >
                <Chip
                  label={CASE_LABELS[i]}
                  tone={
                    i === type
                      ? i === 'emergency' || i === 'accident'
                        ? 'danger'
                        : 'on'
                      : 'neutral'
                  }
                />
              </Pressable>
            ))}
          </View>
          <TextField
            label="Anything else (optional)"
            value={description}
            onChangeText={setDescription}
            multiline
          />
          {report.error ? <Alert tone="danger" message={errorMessage(report.error)} /> : null}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
