import { useMutation } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useState } from 'react';
import { riderApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, ConfirmSheet } from '@/components';

/** RID-14: alerts every dispatcher with the rider's last known location. */
export function EmergencyButton() {
  const [confirming, setConfirming] = useState(false);
  const send = useMutation({
    mutationFn: async () => {
      const p = await Location.getLastKnownPositionAsync().catch(() => null);
      return riderApi.emergency(p ? { lat: p.coords.latitude, lng: p.coords.longitude } : {});
    },
    onSuccess: () => setConfirming(false),
  });
  return (
    <>
      {send.isSuccess ? (
        <Alert
          tone="danger"
          message="Emergency alert sent with your location. Dispatch will call you."
        />
      ) : null}
      {send.error ? <Alert tone="danger" message={errorMessage(send.error)} /> : null}
      <Button variant="danger" label="Emergency" onPress={() => setConfirming(true)} />
      <ConfirmSheet
        visible={confirming}
        title="Send an emergency alert?"
        message="Every dispatcher gets an alarm with your location and calls you."
        confirmLabel="Send Alert"
        danger
        loading={send.isPending}
        onConfirm={() => send.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
