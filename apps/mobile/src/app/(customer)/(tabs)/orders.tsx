import { formatLkr, type OrderSummary } from '@oyo/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, Chip, Screen, Text } from '@/components';
import { useOrders } from '@/customer/queries';
import { exitText, stageText } from '@/customer/stage';
import { useOrderActions } from '@/customer/useOrderActions';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-LK', {
    timeZone: 'Asia/Colombo',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
const METHOD = { cod: 'Cash', bank_transfer: 'Bank transfer', card: 'Card' } as const;

function OrderCard({ o, active }: { o: OrderSummary; active?: boolean }) {
  const actions = useOrderActions();
  const exit = exitText(o.status);
  const delivered = o.status === 'delivered';
  return (
    <Card tone={active ? 'green' : 'default'} style={{ gap: 8 }}>
      {/* Only this part opens the order, so the action buttons aren't nested inside a button. */}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(`/order/${o.id}`)}
        style={{ gap: 8 }}
      >
        <View style={styles.between}>
          <Text variant="strong" style={{ flex: 1 }}>
            {o.restaurant.name}
          </Text>
          <Chip
            label={
              exit
                ? o.status === 'rejected'
                  ? 'Rejected'
                  : o.status === 'failed'
                    ? 'Failed'
                    : 'Cancelled'
                : stageText(o.stage!, o.paymentMethod)
            }
            tone={
              exit
                ? o.status === 'cancelled'
                  ? 'neutral'
                  : 'danger'
                : delivered
                  ? 'neutral'
                  : 'green'
            }
          />
        </View>
        <Text variant="small">
          {[
            `#${o.reference}`,
            active ? null : day(o.placedAt),
            `${o.itemCount} ${o.itemCount === 1 ? 'item' : 'items'}`,
            formatLkr(o.totalCents),
            METHOD[o.paymentMethod],
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Pressable>
      {!active ? (
        <View style={styles.actions}>
          <Button
            small
            variant="secondary"
            label="Reorder"
            loading={actions.again.isPending}
            onPress={() => actions.again.mutate(o.id)}
          />
          {delivered ? (
            <Button variant="ghost" label="Receipt" onPress={() => actions.receipt.mutate(o.id)} />
          ) : null}
          {o.canRate && !o.myRating ? (
            <Button
              variant="ghost"
              label="Rate Order"
              onPress={() => router.push(`/rate/${o.id}`)}
            />
          ) : null}
          <View style={{ flex: 1 }} />
          {o.myRating ? <Text variant="small">{`You rated ${o.myRating}★`}</Text> : null}
        </View>
      ) : null}
      {actions.again.data?.skipped.length ? (
        <Alert message={`Not available any more: ${actions.again.data.skipped.join(', ')}.`} />
      ) : null}
      {actions.again.error || actions.receipt.error ? (
        <Alert tone="danger" message={errorMessage(actions.again.error ?? actions.receipt.error)} />
      ) : null}
    </Card>
  );
}

/** C13: active and past orders, with reorder, receipt and rating (CUS-17). */
export default function Orders() {
  const orders = useOrders();
  const list = orders.data ?? [];
  const active = list.filter((o) => o.stage && o.stage !== 'delivered');
  const past = list.filter((o) => !active.includes(o));
  return (
    <Screen inTabs bodyStyle={{ gap: 12, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Your Orders
      </Text>
      {orders.error ? <Alert tone="danger" message={errorMessage(orders.error)} /> : null}
      {orders.data && list.length === 0 ? (
        <Text variant="muted">No orders yet. Your first one will show here.</Text>
      ) : null}
      {active.length ? <Text variant="label">Active</Text> : null}
      {active.map((o) => (
        <OrderCard key={o.id} o={o} active />
      ))}
      {past.length ? <Text variant="label">Past</Text> : null}
      {past.map((o) => (
        <OrderCard key={o.id} o={o} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
