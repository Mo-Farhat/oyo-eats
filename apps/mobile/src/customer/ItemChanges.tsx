import { formatLkr, type ItemChange, type ItemChangeChoice, type OrderDetail } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, Chip, Text } from '@/components';
import { keys } from '@/customer/queries';
import { mmss, useCountdown } from '@/hooks/useCountdown';

function missingText(c: ItemChange) {
  const missing = c.quantity - c.availableQuantity;
  return missing === c.quantity ? c.name : `${missing} of your ${c.quantity} ${c.name}`;
}

/** The answer the customer gave (or didn't), in one line. */
export function itemChangeSummary(c: ItemChange, order: Pick<OrderDetail, 'paymentMethod'>) {
  const what =
    c.status === 'substituted' && c.substitute
      ? `${missingText(c)} swapped for ${c.substitute.name}`
      : `${missingText(c)} removed`;
  const why = c.resolvedBy === 'timeout' ? ' (no answer in time)' : '';
  const money = c.refundCents
    ? ` We'll refund ${formatLkr(c.refundCents)} to your bank account.`
    : order.paymentMethod === 'cod'
      ? ' Pay the new total to the rider.'
      : '';
  return `${what}${why}.${money}`;
}

function Pending({ order, change }: { order: OrderDetail; change: ItemChange }) {
  const queryClient = useQueryClient();
  const left = useCountdown(change.respondBy);
  const answer = useMutation({
    mutationFn: (choice: ItemChangeChoice) =>
      customerApi.answerItemChange(order.id, change.id, choice),
    onSuccess: (o) => {
      queryClient.setQueryData(keys.order(order.id), o);
      void queryClient.invalidateQueries({ queryKey: keys.orders });
    },
  });
  const sub = change.substitute!;
  const missing = change.quantity - change.availableQuantity;
  const diff = sub.totalCents - change.missingCents;
  return (
    <Card tone="warn" style={{ gap: 10 }}>
      <View style={styles.between}>
        <Text variant="h3" style={{ flex: 1 }}>
          {`${order.restaurant.name} is out of ${change.name}`}
        </Text>
        <Chip tone="warn" label={mmss(left)} />
      </View>
      <Text>
        {`They can make ${missing} × ${sub.name} (${formatLkr(sub.totalCents)}) instead of ${missingText(change)} (${formatLkr(change.missingCents)}).`}
      </Text>
      <Text variant="small">
        {diff === 0
          ? 'Same price.'
          : diff < 0
            ? `Your total goes down by ${formatLkr(-diff)}${order.paymentMethod === 'cod' ? '' : ', refunded by bank transfer'}.`
            : `Your total goes up by ${formatLkr(diff)}, paid to the rider.`}
        {` If you don't answer, it's removed.`}
      </Text>
      {answer.error ? <Alert tone="danger" message={errorMessage(answer.error)} /> : null}
      <Button
        label={`Take ${sub.name}`}
        loading={answer.isPending && answer.variables === 'substitute'}
        disabled={answer.isPending}
        onPress={() => answer.mutate('substitute')}
      />
      <Button
        variant="secondary"
        label="Remove It"
        loading={answer.isPending && answer.variables === 'remove'}
        disabled={answer.isPending}
        onPress={() => answer.mutate('remove')}
      />
    </Card>
  );
}

/** C10 (RES-05): items the restaurant ran out of, with the swap-or-remove choice while pending. */
export function ItemChanges({ order }: { order: OrderDetail }) {
  if (!order.itemChanges.length) return null;
  return (
    <>
      {order.itemChanges.map((c) =>
        c.status === 'pending' && c.substitute && order.status === 'active' ? (
          <Pending key={c.id} order={order} change={c} />
        ) : c.status !== 'pending' ? (
          <Alert key={c.id} tone="info" message={itemChangeSummary(c, order)} />
        ) : null,
      )}
    </>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
