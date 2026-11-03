import { CASE_LABELS, formatLkr, type CaseType, type OrderDetail } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, Chip, Sheet, Text, TextField } from '@/components';

/**
 * Below the order: ask to cancel after the restaurant accepted (C14), report a problem (C19),
 * and what's become of earlier requests.
 */
export function OrderSupport({ order }: { order: OrderDetail }) {
  const queryClient = useQueryClient();
  const key = ['order-cases', order.id];
  const cases = useQuery({ queryKey: key, queryFn: () => customerApi.cases(order.id) });
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const ask = useMutation({
    mutationFn: () => customerApi.cancelRequest(order.id, reason.trim()),
    onSuccess: (c) => {
      queryClient.setQueryData(key, c);
      setAsking(false);
      setReason('');
    },
  });
  const list = cases.data ?? [];
  const cancelOpen = list.some((c) => c.type === 'cancel_request' && c.status !== 'resolved');
  const canAsk = order.status === 'active' && order.deliveryStatus !== null && !order.canCancel;
  const deliveredLongAgo =
    order.status === 'delivered' &&
    order.rateUntil !== null &&
    Date.now() > new Date(order.rateUntil).getTime() + 24 * 3_600_000;
  const canReport =
    ['active', 'picked_up', 'delivered'].includes(order.status) && !deliveredLongAgo;

  return (
    <>
      {list.map((c) => (
        <Card key={c.id} tone={c.status === 'resolved' ? 'default' : 'warn'} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text variant="strong">{CASE_LABELS[c.type as CaseType] ?? 'Request'}</Text>
            <Chip
              label={c.status === 'resolved' ? 'Answered' : 'With the office'}
              tone={c.status === 'resolved' ? 'green' : 'warn'}
            />
          </View>
          {c.refunds.map((r, i) => (
            <Text key={i} variant="small">
              {`Refund ${formatLkr(r.amountCents)} · ${r.status === 'paid' ? 'transferred' : 'on its way'}`}
            </Text>
          ))}
          {c.resolution ? <Text variant="body">{c.resolution}</Text> : null}
        </Card>
      ))}
      {canAsk && !cancelOpen ? (
        <Button variant="secondary" label="Ask to Cancel" onPress={() => setAsking(true)} />
      ) : null}
      {canReport ? (
        <Button
          variant="ghost"
          label="Report a Problem"
          onPress={() => router.push(`/problem/${order.id}`)}
        />
      ) : null}
      <Sheet
        visible={asking}
        onClose={() => setAsking(false)}
        footer={
          <Button
            label="Send Request"
            disabled={reason.trim().length < 3}
            loading={ask.isPending}
            onPress={() => ask.mutate()}
          />
        }
      >
        <Text variant="h2">Ask to cancel</Text>
        <Text variant="muted">
          {`${order.restaurant.name} has started on your order, so the Oyo Eats office decides. You may be charged for food already made; the delivery fee is refunded.`}
        </Text>
        <TextField
          label="Why do you want to cancel?"
          value={reason}
          onChangeText={setReason}
          multiline
        />
        {ask.error ? <Alert tone="danger" message={errorMessage(ask.error)} /> : null}
      </Sheet>
    </>
  );
}
