import { formatLkr } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { riderApi } from '@/api';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  Button,
  Card,
  Chip,
  IconButton,
  Screen,
  SwipeButton,
  Text,
  TextField,
} from '@/components';
import { IssueSheet } from '@/rider/IssueSheet';
import { RIDER_STATE, useRiderState } from '@/rider/queries';
import { colors, fonts } from '@/theme/tokens';

const directions = (lat: number, lng: number) =>
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);

/** R05 to R08: to the restaurant, pickup, to the customer, complete. Status changes are swipe-only. */
export default function Job() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const state = useRiderState();
  const job = state.data?.jobs.find((j) => j.orderId === id);
  const [cash, setCash] = useState('');
  const [reason, setReason] = useState('');
  const [issue, setIssue] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: RIDER_STATE });

  useEffect(() => {
    if (job && !cash && job.collectCents) setCash(String(job.collectCents / 100));
  }, [job?.orderId]);

  const pickup = useMutation({ mutationFn: () => riderApi.pickup(id), onSuccess: refresh });
  const deliver = useMutation({
    mutationFn: () =>
      riderApi.deliver(id, {
        ...(job!.collectCents ? { cashCollectedCents: Math.round(Number(cash) * 100) } : {}),
        ...(reason.trim() ? { varianceReason: reason.trim() } : {}),
      }),
    onSuccess: async () => {
      await refresh();
      // Back to the existing home tab rather than stacking a second copy of it.
      if (router.canGoBack()) router.back();
      else router.replace('/rider');
    },
  });

  const back = (
    <IconButton
      icon="back"
      label="Back"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/rider'))}
    />
  );
  if (!job) {
    return (
      <Screen top={back}>
        <Text variant="muted">
          {state.isLoading ? 'Loading…' : 'This job is finished or no longer yours.'}
        </Text>
      </Screen>
    );
  }

  const atRestaurant = job.status === 'active';
  const ready = job.kitchenStatus === 'ready';
  const cashCents = Math.round(Number(cash || 0) * 100);
  const short = job.collectCents > 0 && cashCents !== job.collectCents;
  const error = pickup.error ?? deliver.error;

  return (
    <Screen
      top={
        <>
          {back}
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              {atRestaurant ? `To ${job.restaurant.name}` : `To ${job.customer.firstName}`}
            </Text>
            <Text variant="small">{`#${job.reference} · ${job.itemCount} ${job.itemCount === 1 ? 'item' : 'items'} · earn ${formatLkr(job.payoutCents)}`}</Text>
          </View>
          <IconButton icon="alert" label="Report an issue" onPress={() => setIssue(true)} />
        </>
      }
      bodyStyle={{ gap: 14 }}
    >
      {atRestaurant ? (
        <>
          <Card>
            <Text variant="label">Pick up</Text>
            <Text variant="strong">{job.restaurant.name}</Text>
            <Text variant="small">{job.restaurant.address}</Text>
            <Button
              small
              variant="secondary"
              label="Directions"
              onPress={() => directions(job.restaurant.lat, job.restaurant.lng)}
            />
          </Card>
          <Card tone="green" style={{ alignItems: 'center', gap: 4 }}>
            <Text variant="label">Tell the counter this number</Text>
            <Text style={styles.bigRef}>{job.reference}</Text>
            <Chip
              tone={ready ? 'green' : 'warn'}
              label={ready ? 'Kitchen: Ready' : 'Kitchen: Preparing'}
            />
          </Card>
          <Text variant="muted">{`Check the bag has ${job.itemCount} ${job.itemCount === 1 ? 'item' : 'items'} before you leave.`}</Text>
          {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
          {ready ? (
            <SwipeButton
              label="Swipe When Picked Up"
              onConfirm={() => pickup.mutate()}
              disabled={pickup.isPending}
            />
          ) : (
            <Alert message="Food not ready yet. The button unlocks when the kitchen marks it ready." />
          )}
        </>
      ) : (
        <>
          <Card>
            <Text variant="label">Deliver to</Text>
            <Text variant="strong">{job.customer.firstName}</Text>
            <Text>{job.customer.address ?? '—'}</Text>
            {job.customer.note ? <Text variant="small">{`Note: ${job.customer.note}`}</Text> : null}
            <View style={styles.row}>
              {job.customer.phone ? (
                <Button
                  small
                  variant="secondary"
                  label="Call"
                  onPress={() => void Linking.openURL(`tel:${job.customer.phone}`)}
                />
              ) : null}
              <Button
                small
                variant="secondary"
                label="Directions"
                onPress={() => directions(job.customer.lat, job.customer.lng)}
              />
            </View>
          </Card>
          <Card style={{ gap: 6 }}>
            <View style={styles.between}>
              <Text variant="strong">{job.collectCents ? 'Collect in cash' : 'Prepaid'}</Text>
              <Text style={styles.total}>
                {job.collectCents ? formatLkr(job.collectCents) : 'Nothing to collect'}
              </Text>
            </View>
            {job.collectCents ? (
              <TextField
                label="Cash collected (LKR)"
                keyboardType="numeric"
                value={cash}
                onChangeText={(t) => setCash(t.replace(/[^\d.]/g, ''))}
              />
            ) : null}
            {short ? (
              <TextField
                label="Why is the cash different?"
                value={reason}
                onChangeText={setReason}
                hint="Required when the amount isn't the total."
              />
            ) : null}
          </Card>
          {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
          <SwipeButton
            label="Swipe to Mark Delivered"
            disabled={
              deliver.isPending ||
              (short && reason.trim().length < 3) ||
              (job.collectCents > 0 && !cash)
            }
            onConfirm={() => deliver.mutate()}
          />
        </>
      )}
      <IssueSheet orderId={job.orderId} visible={issue} onClose={() => setIssue(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bigRef: {
    fontFamily: fonts.display800,
    fontSize: 48,
    lineHeight: 56,
    color: colors.strong,
    letterSpacing: 2,
  },
  row: { flexDirection: 'row', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { fontFamily: fonts.display700, fontSize: 18, color: colors.strong },
});
