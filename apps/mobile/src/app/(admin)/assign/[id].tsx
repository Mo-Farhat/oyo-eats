import { formatLkr, type CandidateRider } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, BottomBar, Button, Card, Chip, IconButton, Screen, Text } from '@/components';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { DISPATCH_BOARD, useDispatchBoard } from '@/admin/queries';
import { colors, fonts } from '@/theme/tokens';

const REASON: Record<string, string> = {
  offline: 'Offline',
  paused: 'Paused',
  job_cap: 'At job cap',
  cash_cap: 'At cash cap',
  declined: 'Declined this',
};
const km = (m: number | null) => (m === null ? 'No location' : `${(m / 1000).toFixed(1)} km`);
const seen = (iso: string | null) => {
  if (!iso) return 'never seen';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  return s < 120 ? `ping ${s}s` : `ping ${Math.round(s / 60)} min`;
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function RiderRow({
  r,
  selected,
  onSelect,
}: {
  r: CandidateRider;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = !r.eligible
    ? (REASON[r.reasons[0] ?? ''] ?? 'Unavailable')
    : r.activeJobs
      ? `${r.activeJobs} active`
      : 'Idle';
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !r.eligible }}
      disabled={!r.eligible}
      onPress={onSelect}
      style={[styles.row, selected && styles.rowOn, !r.eligible && { opacity: 0.45 }]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(r.name)}</Text>
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.between}>
          <Text variant="strong">{r.name}</Text>
          <Chip label={status} tone={!r.eligible ? 'neutral' : r.activeJobs ? 'info' : 'green'} />
        </View>
        <Text variant="small">
          {[
            km(r.distanceMeters),
            `${r.activeJobs} active`,
            `Cash ${formatLkr(r.cashHeldCents)}`,
            seen(r.lastSeenAt),
          ].join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

/** A03 + A06: pick an eligible rider, offer, then watch the offer until it's answered. */
export default function Assign() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const board = useDispatchBoard();
  const order =
    board.data && [...board.data.unassigned, ...board.data.assigned].find((o) => o.id === id);
  const [riderId, setRiderId] = useState<string>();
  const lock = useMutation({ mutationFn: () => dispatchApi.lock(id) });
  const candidates = useQuery({
    queryKey: ['candidates', id],
    queryFn: () => dispatchApi.candidates(id),
    refetchInterval: 10_000,
  });
  const offerLeft = useCountdown(order?.offer?.expiresAt);

  // Opening the assign flow takes the 30 s soft lock (section 8 rule 6).
  useEffect(() => {
    lock.mutate();
  }, [id]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: DISPATCH_BOARD });
    void queryClient.invalidateQueries({ queryKey: ['candidates', id] });
  };
  const offer = useMutation({
    mutationFn: () => dispatchApi.offer(id, riderId!),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => dispatchApi.cancelOffer(order!.offer!.id),
    onSuccess: () => {
      refresh();
      lock.mutate();
    },
  });

  const list = candidates.data ?? [];
  const chosen = list.find((r) => r.id === riderId) ?? list.find((r) => r.eligible);
  useEffect(() => {
    if (!riderId && chosen) setRiderId(chosen.id);
  }, [chosen, riderId]);

  const assigned = order?.deliveryStatus === 'assigned';
  const pending = order?.offer && offerLeft > 0;

  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin'))}
          />
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              {order ? `Assign #${order.reference}` : 'Assign'}
            </Text>
            {order ? (
              <Text variant="small">{`Pick up at ${order.restaurant.name} · ${order.kitchenStatus === 'ready' ? 'food ready' : 'food being prepared'}`}</Text>
            ) : null}
          </View>
        </>
      }
      footer={
        !assigned && !pending ? (
          <BottomBar>
            <Button
              label={chosen ? `Offer to ${chosen.name.split(' ')[0]}` : 'No rider available'}
              disabled={!chosen || !!lock.error}
              loading={offer.isPending}
              onPress={() => offer.mutate()}
            />
          </BottomBar>
        ) : null
      }
      bodyStyle={{ gap: 10 }}
    >
      {lock.error ? <Alert tone="danger" message={errorMessage(lock.error)} /> : null}
      {offer.error || cancel.error ? (
        <Alert tone="danger" message={errorMessage(offer.error ?? cancel.error)} />
      ) : null}

      {assigned ? (
        <Card tone="green">
          <Text variant="strong">{`${order?.rider?.name} accepted`}</Text>
          <Text variant="muted">The order is assigned. You can follow it on the board.</Text>
          <Button variant="secondary" label="Back to Board" onPress={() => router.back()} />
        </Card>
      ) : pending ? (
        <Card tone="warn" style={{ alignItems: 'center', gap: 6 }}>
          <Text variant="label">{`Offered to ${order!.offer!.riderName}`}</Text>
          <Text variant="big">{mmss(offerLeft)}</Text>
          <Text variant="small">Waiting for the rider to accept. No answer counts as a miss.</Text>
          <Button
            variant="secondary"
            label="Cancel Offer"
            loading={cancel.isPending}
            onPress={() => cancel.mutate()}
          />
        </Card>
      ) : (
        <>
          <Text variant="small">{`${list.filter((r) => r.online).length} online · sorted by distance to the restaurant`}</Text>
          {list.map((r) => (
            <RiderRow
              key={r.id}
              r={r}
              selected={r.id === chosen?.id}
              onSelect={() => setRiderId(r.id)}
            />
          ))}
          {candidates.data && list.length === 0 ? (
            <Text variant="muted">No riders yet.</Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowOn: { borderWidth: 2, borderColor: colors.brand },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 9999,
    backgroundColor: '#2d333c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display700, fontSize: 15, color: colors.strong },
});
