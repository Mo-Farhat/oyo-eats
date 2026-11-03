import type { AdminOrderDetail, RefundInput } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { DISPATCH_BOARD } from '@/admin/queries';
import { RefundForm } from '@/admin/RefundForm';
import { call, localPhone } from '@/call';
import {
  Alert,
  Button,
  Card,
  Chip,
  IconButton,
  PriceRow,
  Screen,
  Sheet,
  Text,
  TextField,
} from '@/components';
import { colors } from '@/theme/tokens';

const EVENT: Record<string, string> = {
  placed: 'Order placed',
  slip_uploaded: 'Bank slip uploaded',
  slip_approved: 'Payment approved',
  slip_rejected: 'Slip rejected',
  payment_expired: 'Payment window passed',
  restaurant_accepted: 'Restaurant accepted',
  restaurant_rejected: 'Restaurant rejected',
  restaurant_timed_out: 'Restaurant didn’t respond',
  prep_delayed: 'Restaurant running late',
  marked_ready: 'Food ready',
  item_unavailable: 'Item unavailable',
  item_change_resolved: 'Item change settled',
  cancelled_items_unavailable: 'Cancelled: nothing left to make',
  offer_sent: 'Offered to a rider',
  offer_accepted: 'Rider accepted',
  offer_declined: 'Rider declined',
  offer_expired: 'Offer timed out',
  offer_cancelled: 'Offer withdrawn',
  assignment_cancelled: 'Rider taken off',
  picked_up: 'Picked up',
  delivered: 'Delivered',
  cancelled_by_customer: 'Cancelled by the customer',
  cancelled_by_admin: 'Cancelled by dispatch',
  delivery_failed: 'Delivery failed',
};
const STATUS: Record<string, string> = {
  awaiting_payment: 'Waiting for payment',
  awaiting_restaurant: 'Waiting for the restaurant',
  active: 'In progress',
  picked_up: 'On the way',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  failed: 'Failed',
};
const OUTCOME: Record<string, string> = {
  pending: 'waiting',
  accepted: 'accepted',
  declined: 'declined',
  expired: 'timed out',
  cancelled: 'withdrawn',
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });
const CANCEL_REASONS = [
  'Customer asked to cancel',
  'Restaurant can’t make it',
  'No rider available',
  'Customer unreachable',
];
const FAIL_REASONS = ['Customer not answering', 'Wrong or unreachable address', 'Customer refused'];

function Contact({ label, name, phone }: { label: string; name: string; phone: string | null }) {
  return (
    <View style={styles.contact}>
      <View style={{ flex: 1 }}>
        <Text variant="label">{label}</Text>
        <Text variant="strong">{name}</Text>
        {phone ? <Text variant="small">{localPhone(phone)}</Text> : null}
      </View>
      {phone ? <Button small variant="secondary" label="Call" onPress={() => call(phone)} /> : null}
    </View>
  );
}

/** A02: one order for dispatch: contacts, timeline with who and why, offers, money, actions. */
export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const key = ['admin-order', id];
  const order = useQuery({
    queryKey: key,
    queryFn: () => dispatchApi.order(id),
    refetchInterval: 10_000,
  });
  const [action, setAction] = useState<'cancel' | 'failed' | null>(null);
  const [reason, setReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const refundKey = useMemo(() => Crypto.randomUUID(), [refunding]);
  const refund = useMutation({
    mutationFn: (input: RefundInput) => dispatchApi.refundOrder(id, input, refundKey),
    onSuccess: (c) => {
      setRefunding(false);
      void queryClient.invalidateQueries({ queryKey: key });
      router.push(`/case/${c.id}`);
    },
  });
  const act = useMutation({
    mutationFn: () =>
      action === 'cancel'
        ? dispatchApi.cancelOrder(id, reason.trim())
        : dispatchApi.markFailed(id, reason.trim()),
    onSuccess: (o: AdminOrderDetail) => {
      queryClient.setQueryData(key, o);
      void queryClient.invalidateQueries({ queryKey: DISPATCH_BOARD });
      setAction(null);
      setReason('');
    },
  });
  const o = order.data;
  const open = o && !['delivered', 'rejected', 'cancelled', 'failed'].includes(o.status);

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
              {o ? `#${o.reference}` : 'Order'}
            </Text>
            {o ? (
              <Text variant="small">{`${o.restaurant.name} · ${STATUS[o.status] ?? o.status}`}</Text>
            ) : null}
          </View>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      {order.error ? <Alert tone="danger" message={errorMessage(order.error)} /> : null}
      {o ? (
        <>
          {open && o.status === 'active' && !o.rider ? (
            <Button label="Assign Rider" onPress={() => router.push(`/assign/${o.id}`)} />
          ) : null}

          <Card style={{ gap: 10 }}>
            <Contact label="Customer" name={o.customer.name} phone={o.customer.phone} />
            <View>
              <Text variant="label">Deliver to</Text>
              <Text variant="body">{o.deliveryAddress.addressText ?? '—'}</Text>
              {o.deliveryAddress.note ? (
                <Text variant="small">{`Note: ${o.deliveryAddress.note}`}</Text>
              ) : null}
            </View>
            {o.rider ? (
              <Contact
                label={`Rider${o.rider.plate ? ` · ${o.rider.plate}` : ''}`}
                name={o.rider.name}
                phone={o.rider.phone}
              />
            ) : null}
          </Card>

          <Card style={{ gap: 6 }}>
            <Text variant="h3">Timeline</Text>
            {o.events.map((e, i) => (
              <View key={`${e.type}-${i}`} style={styles.event}>
                <Text variant="small" style={styles.time}>
                  {time(e.at)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text variant="strong">{EVENT[e.type] ?? e.type}</Text>
                  <Text variant="small">{[e.actor, e.note].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
            ))}
          </Card>

          {o.offers.length ? (
            <Card style={{ gap: 6 }}>
              <Text variant="h3">Offers</Text>
              {o.offers.map((f, i) => (
                <View key={i} style={styles.between}>
                  <Text variant="body" style={{ flex: 1 }}>
                    {`${time(f.sentAt)}  ${f.riderName}`}
                  </Text>
                  <Chip
                    label={`${OUTCOME[f.outcome] ?? f.outcome}${f.reason ? ` · ${f.reason}` : ''}`}
                    tone={
                      f.outcome === 'accepted'
                        ? 'green'
                        : f.outcome === 'pending'
                          ? 'warn'
                          : 'neutral'
                    }
                  />
                </View>
              ))}
            </Card>
          ) : null}

          <Card style={{ gap: 6 }}>
            <Text variant="h3">Items</Text>
            {o.lines.map((l, i) => (
              <View key={i}>
                <PriceRow label={`${l.quantity} × ${l.name}`} cents={l.lineTotalCents} />
                {l.modifiers.length ? (
                  <Text variant="small">{l.modifiers.map((m) => m.name).join(', ')}</Text>
                ) : null}
                {l.note ? <Text variant="small">{`Note: ${l.note}`}</Text> : null}
              </View>
            ))}
            <PriceRow label="Delivery" cents={o.deliveryFeeCents} />
            <PriceRow
              label={
                o.paymentMethod === 'cod' ? 'Total · cash on delivery' : 'Total · bank transfer'
              }
              cents={o.totalCents}
              total
            />
          </Card>

          {o.refundableCents > 0 ? (
            <Button variant="secondary" label="Refund" onPress={() => setRefunding(true)} />
          ) : null}
          {o.canMarkFailed ? (
            <Button
              variant="secondary"
              label="Delivery Failed"
              onPress={() => setAction('failed')}
            />
          ) : null}
          {o.canAdminCancel ? (
            <Button variant="ghost" label="Cancel Order" onPress={() => setAction('cancel')} />
          ) : null}
        </>
      ) : null}

      <Sheet
        visible={!!action}
        onClose={() => setAction(null)}
        footer={
          <Button
            variant="danger"
            label={action === 'cancel' ? 'Cancel Order' : 'Mark Failed'}
            disabled={reason.trim().length < 3}
            loading={act.isPending}
            onPress={() => act.mutate()}
          />
        }
      >
        <Text variant="h2">
          {action === 'cancel' ? `Cancel #${o?.reference ?? ''}?` : 'Delivery failed'}
        </Text>
        <Text variant="muted">
          {action === 'cancel'
            ? o?.paymentMethod === 'bank_transfer'
              ? 'The customer and restaurant are told. If the transfer was paid, a refund case opens for the office.'
              : 'The customer, restaurant and rider are told. The reason goes in the timeline.'
            : 'The rider couldn’t hand the food over. The reason goes in the timeline.'}
        </Text>
        <View style={styles.reasons}>
          {(action === 'cancel' ? CANCEL_REASONS : FAIL_REASONS).map((r) => (
            <Pressable key={r} accessibilityRole="button" onPress={() => setReason(r)}>
              <Chip label={r} tone={reason === r ? 'on' : 'neutral'} />
            </Pressable>
          ))}
        </View>
        <TextField label="Reason" value={reason} onChangeText={setReason} />
        {act.error ? <Alert tone="danger" message={errorMessage(act.error)} /> : null}
      </Sheet>
      <Sheet visible={refunding} onClose={() => setRefunding(false)} tall>
        <Text variant="h2">Refund</Text>
        {refund.error ? <Alert tone="danger" message={errorMessage(refund.error)} /> : null}
        {o ? (
          <RefundForm
            refundableCents={o.refundableCents}
            hasRider={!!o.rider}
            busy={refund.isPending}
            defaultReason="goodwill"
            onSubmit={(input) => refund.mutate(input)}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  event: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  time: { width: 44, color: colors.muted },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
