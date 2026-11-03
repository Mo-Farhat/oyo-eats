import { CUSTOMER_STAGES, formatLkr } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  Button,
  Card,
  ConfirmSheet,
  IconButton,
  PriceRow,
  Screen,
  Text,
} from '@/components';
import { BankTransferPanel } from '@/customer/BankTransferPanel';
import { ItemChanges } from '@/customer/ItemChanges';
import { OrderSupport } from '@/customer/OrderSupport';
import { RiderAssignedPopup, RiderCard } from '@/customer/RiderCard';
import { keys, useOrder } from '@/customer/queries';
import { exitText, STAGE_LABELS, stageText } from '@/customer/stage';
import { useOrderActions } from '@/customer/useOrderActions';
import { colors } from '@/theme/tokens';

/** Which order events mark each step, for the time shown beside it. */
const STAGE_EVENTS: Record<(typeof CUSTOMER_STAGES)[number], string[]> = {
  placed: ['placed'],
  confirmed: ['payment_confirmed', 'slip_approved'],
  preparing: ['restaurant_accepted'],
  ready: ['marked_ready'],
  rider_assigned: ['offer_accepted'],
  picked_up: ['picked_up'],
  delivered: ['delivered'],
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-LK', {
    timeZone: 'Asia/Colombo',
    hour: 'numeric',
    minute: '2-digit',
  });

/** C09 (first pass) and C10: timeline, the rider with a Call button, totals, cancel. Live map follows. */
export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const order = useOrder(id);
  const [confirming, setConfirming] = useState(false);
  const actions = useOrderActions();
  const cancel = useMutation({
    mutationFn: () => customerApi.cancelOrder(id),
    onSuccess: (o) => {
      queryClient.setQueryData(keys.order(id), o);
      void queryClient.invalidateQueries({ queryKey: keys.orders });
      setConfirming(false);
    },
  });

  const o = order.data;
  const current = o?.stage ? CUSTOMER_STAGES.indexOf(o.stage) : -1;
  const exit = o ? exitText(o.status) : null;

  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          />
          <Text variant="h2" accessibilityRole="header">
            {o ? `Order #${o.reference}` : 'Order'}
          </Text>
        </>
      }
      bodyStyle={{ gap: 14 }}
    >
      {order.error ? <Alert tone="danger" message={errorMessage(order.error)} /> : null}
      {o ? (
        <>
          <View style={{ gap: 4 }}>
            <Text variant="h3">{o.restaurant.name}</Text>
            <Text variant="lede">{exit ?? stageText(o.stage!, o.paymentMethod)}</Text>
          </View>
          {o.status === 'awaiting_payment' && o.bankTransfer ? (
            <BankTransferPanel order={o} />
          ) : null}
          {o.rider?.phone ? <RiderCard rider={o.rider} /> : null}
          <RiderAssignedPopup order={o} />
          <ItemChanges order={o} />
          {exit ? (
            <Alert
              tone="danger"
              message={`${exit}. ${o.status === 'rejected' ? 'Nothing was charged.' : ''}`}
            />
          ) : null}

          {!exit ? (
            <Card style={{ gap: 0 }}>
              {CUSTOMER_STAGES.map((s, i) => {
                const done = i < current || o.stage === 'delivered';
                const now = i === current && o.stage !== 'delivered';
                const event = [...o.timeline]
                  .reverse()
                  .find((e) => STAGE_EVENTS[s].includes(e.type));
                return (
                  <View key={s} style={styles.step}>
                    <View style={{ alignItems: 'center' }}>
                      <View style={[styles.dot, done && styles.dotDone, now && styles.dotNow]} />
                      {i < CUSTOMER_STAGES.length - 1 ? (
                        <View style={[styles.line, done && styles.lineDone]} />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 14 }}>
                      <Text
                        variant={now ? 'strong' : 'body'}
                        style={!done && !now ? { color: colors.muted } : undefined}
                      >
                        {STAGE_LABELS[s]}
                      </Text>
                      {event ? <Text variant="small">{time(event.at)}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </Card>
          ) : null}

          <Card style={{ gap: 2 }}>
            {o.lines.map((l, i) => (
              <PriceRow
                key={i}
                label={`${l.quantity} × ${l.name}${l.modifiers.length ? ` (${l.modifiers.map((m) => m.name).join(', ')})` : ''}`}
                cents={l.lineTotalCents}
              />
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
          {o.deliveryAddress.addressText ? (
            <Text variant="small">{`Delivering to ${o.deliveryAddress.addressText}`}</Text>
          ) : null}

          {o.canRate ? (
            <Button
              label={o.ratings.restaurant ? 'Edit Your Rating' : 'Rate Order'}
              onPress={() => router.push(`/rate/${o.id}`)}
            />
          ) : null}
          {o.status === 'delivered' ? (
            <Button
              variant="secondary"
              label="Receipt (PDF)"
              loading={actions.receipt.isPending}
              onPress={() => actions.receipt.mutate(o.id)}
            />
          ) : null}
          {['delivered', 'cancelled', 'rejected', 'failed'].includes(o.status) ? (
            <Button
              variant="secondary"
              label="Reorder"
              loading={actions.again.isPending}
              onPress={() => actions.again.mutate(o)}
            />
          ) : null}
          {actions.again.data?.skipped.length ? (
            <Alert message={`Not available any more: ${actions.again.data.skipped.join(', ')}.`} />
          ) : null}
          {actions.receipt.error || actions.again.error ? (
            <Alert
              tone="danger"
              message={errorMessage(actions.receipt.error ?? actions.again.error)}
            />
          ) : null}
          {o.canCancel ? (
            <Button variant="secondary" label="Cancel Order" onPress={() => setConfirming(true)} />
          ) : null}
          {cancel.error ? <Alert tone="danger" message={errorMessage(cancel.error)} /> : null}
          <OrderSupport order={o} />
          <ConfirmSheet
            visible={confirming}
            title="Cancel This Order?"
            message={
              o.bankTransfer?.slip && ['pending', 'approved'].includes(o.bankTransfer.slip.status)
                ? `You've already sent ${formatLkr(o.totalCents)} by bank transfer. Our team will contact you to refund it in full.`
                : `The restaurant hasn't accepted it yet, so you won't be charged. Total ${formatLkr(o.totalCents)}.`
            }
            confirmLabel="Cancel Order"
            danger
            loading={cancel.isPending}
            onConfirm={() => cancel.mutate()}
            onCancel={() => setConfirming(false)}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: 14 },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 9999,
    backgroundColor: colors.raise,
    borderWidth: 2,
    borderColor: colors.idle,
  },
  dotDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  dotNow: { backgroundColor: colors.page, borderWidth: 6, borderColor: colors.brand },
  line: { width: 2, flex: 1, minHeight: 18, backgroundColor: colors.idle, marginVertical: 2 },
  lineDone: { backgroundColor: colors.brand },
});
