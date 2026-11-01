import { formatLkr, PREP_PRESETS, type RejectReason, type RestaurantOrder } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  IconButton,
  Radio,
  Screen,
  Sheet,
  Text,
} from '@/components';
import { mmss, useCountdown } from '@/hooks/useCountdown';
import { BOARD, useBoardOrder } from '@/restaurant/queries';
import { colors, fonts } from '@/theme/tokens';

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-LK', {
    timeZone: 'Asia/Colombo',
    hour: 'numeric',
    minute: '2-digit',
  });

const REASONS: { value: RejectReason; label: string }[] = [
  { value: 'item_unavailable', label: 'Item unavailable' },
  { value: 'too_busy', label: 'Too busy right now' },
  { value: 'closing_soon', label: 'Closing soon' },
  { value: 'other', label: 'Other' },
];

function Items({ o, checkable }: { o: RestaurantOrder; checkable?: boolean }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  return (
    <Card style={{ gap: 0, paddingVertical: 4 }}>
      {o.lines.map((l, i) => {
        const detail = [l.modifiers.join(', '), l.note ? `note: ${l.note}` : '']
          .filter(Boolean)
          .join(' · ');
        const text = (
          <View style={{ flex: 1 }}>
            <Text variant="strong">{`${l.quantity} × ${l.name}`}</Text>
            {detail ? <Text variant="small">{detail}</Text> : null}
          </View>
        );
        return (
          <View key={i} style={styles.line}>
            {checkable ? (
              <Checkbox
                label={l.name}
                checked={done.has(i)}
                onChange={() => {
                  const next = new Set(done);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  setDone(next);
                }}
              >
                {text}
              </Checkbox>
            ) : (
              text
            )}
            {checkable ? null : <Text>{formatLkr(l.lineTotalCents)}</Text>}
          </View>
        );
      })}
      {checkable ? null : (
        <View style={styles.total}>
          <Text variant="strong">Food total</Text>
          <Text variant="strong">{formatLkr(o.itemsCents)}</Text>
        </View>
      )}
    </Card>
  );
}

function RiderCard({ o }: { o: RestaurantOrder }) {
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>
          {o.rider
            ? o.rider.name
                .split(' ')
                .map((w) => w[0])
                .join('')
                .slice(0, 2)
            : '?'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="small">{o.rider ? 'Rider assigned' : 'Rider'}</Text>
        <Text variant="strong">
          {o.rider ? `${o.rider.name} · ${o.rider.plate}` : 'Not assigned yet'}
        </Text>
        {o.rider ? (
          <Text variant="small">{o.rider.vehicle}</Text>
        ) : (
          <Text variant="small">Dispatch is finding a rider.</Text>
        )}
      </View>
    </Card>
  );
}

/** T03 to T06: one order, by stage. */
export default function KitchenOrder() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const o = useBoardOrder(id);
  const [prep, setPrep] = useState<number>(20);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectReason>('item_unavailable');
  const [soldOut, setSoldOut] = useState<Set<string>>(new Set());
  const respond = useCountdown(o?.respondBy);
  const readyLeft = useCountdown(o?.readyBy);

  const done = () => void queryClient.invalidateQueries({ queryKey: BOARD });
  const accept = useMutation({ mutationFn: () => restaurantApi.accept(id, prep), onSuccess: done });
  const reject = useMutation({
    mutationFn: () =>
      restaurantApi.reject(id, {
        reason,
        soldOutItemIds: reason === 'item_unavailable' ? [...soldOut] : [],
      }),
    onSuccess: () => {
      setRejecting(false);
      done();
      router.back();
    },
  });
  const ready = useMutation({ mutationFn: () => restaurantApi.ready(id), onSuccess: done });
  const delay = useMutation({
    mutationFn: (m: number) => restaurantApi.delay(id, m),
    onSuccess: done,
  });
  const error = accept.error ?? reject.error ?? ready.error ?? delay.error;

  const back = (
    <IconButton
      icon="back"
      label="Back"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/restaurant'))}
    />
  );
  if (!o) {
    return (
      <Screen top={back}>
        <Text variant="muted">Loading…</Text>
      </Screen>
    );
  }

  const stage =
    o.status === 'awaiting_restaurant' ? 'new' : o.status === 'active' ? o.kitchenStatus : 'done';
  const readyAt = new Date(Date.now() + prep * 60_000).toISOString();

  return (
    <Screen
      top={
        <>
          {back}
          <View style={{ flex: 1 }}>
            <Text variant="h2" accessibilityRole="header">
              {stage === 'ready' ? 'Ready for Pickup' : `Order #${o.reference}`}
            </Text>
            <Text variant="small">
              {stage === 'new'
                ? `${o.customerFirstName} · ${o.paid ? 'Paid' : 'Cash on delivery'} · ${time(o.placedAt)}`
                : stage === 'ready' && o.readyAt
                  ? `Marked ready ${time(o.readyAt)}`
                  : o.acceptedAt
                    ? `Accepted ${time(o.acceptedAt)} · ${o.prepMinutes} min`
                    : time(o.placedAt)}
            </Text>
          </View>
          {stage === 'new' ? <Chip tone="danger" label={mmss(respond)} /> : null}
          {stage === 'preparing' ? <Chip tone="warn" label="Preparing" /> : null}
        </>
      }
      bodyStyle={{ gap: 14 }}
    >
      {stage === 'new' ? (
        <>
          <Items o={o} />
          <Text variant="small">
            You don't see the customer's phone or address. The rider handles delivery.
          </Text>
          <Text variant="label">How long to prepare?</Text>
          <View style={styles.grid}>
            {PREP_PRESETS.map((m) => (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityState={{ checked: prep === m }}
                onPress={() => setPrep(m)}
                style={[styles.preset, prep === m && styles.presetOn]}
              >
                <Text style={styles.presetText}>{`${m} min`}</Text>
              </Pressable>
            ))}
          </View>
          <Alert
            tone="green"
            message={`Customer sees “Ready ~${time(readyAt)}”. Dispatch may already be assigning a rider.`}
          />
          {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button variant="secondary" label="Reject" onPress={() => setRejecting(true)} />
            </View>
            <View style={{ flex: 2 }}>
              <Button
                label={`Accept · ${prep} min`}
                loading={accept.isPending}
                onPress={() => accept.mutate()}
              />
            </View>
          </View>
        </>
      ) : null}

      {stage === 'preparing' ? (
        <>
          <Card tone="warn" style={{ alignItems: 'center', gap: 2 }}>
            <Text variant="label">
              {o.readyBy ? `Promised ready by ${time(o.readyBy)}` : 'Preparing'}
            </Text>
            <Text variant="big">{readyLeft > 0 ? mmss(readyLeft) : 'Late'}</Text>
            <Text variant="small">{readyLeft > 0 ? 'minutes left' : 'Past the promised time'}</Text>
          </Card>
          <Items o={o} checkable />
          <RiderCard o={o} />
          <Text variant="label">Running late?</Text>
          <View style={styles.row}>
            {[5, 10].map((m) => (
              <View key={m} style={{ flex: 1 }}>
                <Button
                  small
                  variant="secondary"
                  label={`+${m} min`}
                  loading={delay.isPending && delay.variables === m}
                  onPress={() => delay.mutate(m)}
                  style={{ alignSelf: 'stretch' }}
                />
              </View>
            ))}
          </View>
          <Text variant="small">Adding delay updates the customer's time and alerts dispatch.</Text>
          {error ? <Alert tone="danger" message={errorMessage(error)} /> : null}
          <Button label="Mark Ready" loading={ready.isPending} onPress={() => ready.mutate()} />
        </>
      ) : null}

      {stage === 'ready' ? (
        <>
          <Card tone="green" style={{ alignItems: 'center', gap: 4 }}>
            <Text variant="label">Order number</Text>
            <Text style={styles.bigRef}>{o.reference}</Text>
            <Text variant="small">The rider will say this number at the counter</Text>
          </Card>
          <Text variant="label">Hand only to this rider</Text>
          <RiderCard o={o} />
          <Alert
            tone="info"
            message="The order moves to Done when the rider taps “Picked up” on their phone. You don't need to do anything else."
          />
        </>
      ) : null}

      {stage === 'done' ? (
        <>
          <Items o={o} />
          <Chip
            label={
              o.status === 'rejected'
                ? 'Rejected'
                : o.status === 'cancelled'
                  ? 'Cancelled'
                  : 'Picked up'
            }
          />
        </>
      ) : null}

      <Sheet visible={rejecting} onClose={() => setRejecting(false)}>
        <View style={{ gap: 4 }}>
          <Text variant="h2">{`Reject Order #${o.reference}?`}</Text>
          <Text variant="muted">
            The customer is told right away. Anything already paid is refunded.
          </Text>
        </View>
        {REASONS.map((r) => (
          <View key={r.value}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: reason === r.value }}
              onPress={() => setReason(r.value)}
              style={styles.reason}
            >
              <Radio on={reason === r.value} />
              <Text style={{ flex: 1 }}>{r.label}</Text>
            </Pressable>
            {r.value === 'item_unavailable' && reason === 'item_unavailable' ? (
              <View style={{ paddingLeft: 34, gap: 8, paddingBottom: 8 }}>
                {[...new Map(o.lines.map((l) => [l.menuItemId, l])).values()].map((l) => (
                  <Checkbox
                    key={l.menuItemId}
                    label={`${l.name} sold out`}
                    checked={soldOut.has(l.menuItemId)}
                    onChange={() => {
                      const next = new Set(soldOut);
                      if (next.has(l.menuItemId)) next.delete(l.menuItemId);
                      else next.add(l.menuItemId);
                      setSoldOut(next);
                    }}
                  >
                    <Text>{l.name}</Text>
                  </Checkbox>
                ))}
                <Text variant="small">Ticked items are marked Sold out on your menu.</Text>
              </View>
            ) : null}
          </View>
        ))}
        {reject.error ? <Alert tone="danger" message={errorMessage(reject.error)} /> : null}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Button variant="secondary" label="Back" onPress={() => setRejecting(false)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="danger"
              label="Reject Order"
              loading={reject.isPending}
              onPress={() => reject.mutate()}
            />
          </View>
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  total: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: {
    width: '31%',
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  presetText: { fontFamily: fonts.sans700, color: colors.strong, fontSize: 15 },
  row: { flexDirection: 'row', gap: 10 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 9999,
    backgroundColor: '#2d333c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.display700, fontSize: 16, color: colors.strong },
  bigRef: {
    fontFamily: fonts.display800,
    fontSize: 56,
    lineHeight: 66,
    color: colors.strong,
    letterSpacing: 2,
  },
});
