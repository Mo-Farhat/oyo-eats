import { formatLkr, type PaymentMethod } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { customerApi } from '@/api';
import { errorMessage } from '@/api/messages';
import {
  Alert,
  BottomBar,
  Button,
  Icon,
  IconButton,
  PriceRow,
  Radio,
  Screen,
  Text,
  Card,
} from '@/components';
import { keys, useDeliveryAddress, useQuote } from '@/customer/queries';
import { useCustomer } from '@/customer/store';
import { colors, fonts } from '@/theme/tokens';

const METHODS: Record<
  PaymentMethod,
  { title: string; icon: 'cash' | 'bank'; detail: (total: string) => string }
> = {
  cod: { title: 'Cash on delivery', icon: 'cash', detail: (t) => `Pay the rider ${t}` },
  bank_transfer: {
    title: 'Bank transfer',
    icon: 'bank',
    detail: () => 'Upload slip · kitchen starts after we verify',
  },
  card: {
    title: 'Card / online',
    icon: 'bank',
    detail: () => 'Visa, Mastercard via secure checkout',
  },
};

/** C07: confirm address and payment, see the server's totals, place the order. */
export default function Checkout() {
  const queryClient = useQueryClient();
  const { address } = useDeliveryAddress();
  const clear = useCustomer((s) => s.clear);
  const quote = useQuote();
  const q = quote.data;
  const [method, setMethod] = useState<PaymentMethod>('cod');

  useEffect(() => {
    if (q && !q.paymentMethods.includes(method)) setMethod(q.paymentMethods[0] ?? 'cod');
  }, [q, method]);

  // One key per version of the order: a retry after a dropped connection reuses it (SEC-22).
  const draftKey = JSON.stringify([quote.draft, method]);
  const idempotencyKey = useMemo(() => Crypto.randomUUID(), [draftKey]);

  const place = useMutation({
    mutationFn: () =>
      customerApi.placeOrder({ ...quote.draft!, paymentMethod: method }, idempotencyKey),
    onSuccess: async (order) => {
      clear();
      await queryClient.invalidateQueries({ queryKey: keys.orders });
      router.dismissAll();
      router.replace(`/order/${order.id}`);
    },
  });

  const total = q ? formatLkr(q.totalCents) : '';
  const km = q ? (q.routeMeters / 1000).toFixed(1) : '';

  return (
    <Screen
      top={
        <>
          <IconButton icon="back" label="Back" onPress={() => router.back()} />
          <Text variant="h2" accessibilityRole="header">
            Checkout
          </Text>
        </>
      }
      footer={
        <BottomBar>
          <Button
            label={q ? `Place Order · ${total}` : 'Place Order'}
            onPress={() => place.mutate()}
            loading={place.isPending}
            disabled={!q || !!quote.error || !quote.draft}
          />
        </BottomBar>
      }
      bodyStyle={{ gap: 12 }}
    >
      <Card style={styles.address}>
        <View style={styles.tile}>
          <Icon name="pin" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="strong">
            {address ? `${address.label} · ${address.addressText}` : 'No address'}
          </Text>
          {address?.note ? <Text variant="small">{address.note}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={() => router.push('/location')} hitSlop={8}>
          <Text style={styles.change}>Change</Text>
        </Pressable>
      </Card>

      <Text variant="label">Pay with</Text>
      {(q?.paymentMethods ?? []).map((m) => {
        const on = m === method;
        return (
          <Pressable
            key={m}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => setMethod(m)}
            style={[styles.method, on && styles.methodOn]}
          >
            <Radio on={on} />
            <Icon name={METHODS[m].icon} />
            <View style={{ flex: 1 }}>
              <Text variant="strong">{METHODS[m].title}</Text>
              <Text variant="small">{METHODS[m].detail(total)}</Text>
            </View>
          </Pressable>
        );
      })}

      {q ? (
        <Card style={{ gap: 2 }}>
          <PriceRow
            label={`Items (${q.lines.reduce((n, l) => n + l.quantity, 0)})`}
            cents={q.itemsCents}
          />
          <PriceRow label={`Delivery · ${km} km`} cents={q.deliveryFeeCents} />
          <Text variant="small">{`${formatLkr(q.baseFeeCents)} base + ${km} km × ${formatLkr(q.perKmCents)}`}</Text>
          {q.restaurantFeeCents ? (
            <PriceRow label="Restaurant fee" cents={q.restaurantFeeCents} />
          ) : null}
          <PriceRow label="Total" cents={q.totalCents} total />
        </Card>
      ) : null}
      {quote.error ? <Alert tone="danger" message={errorMessage(quote.error)} /> : null}
      {place.error ? <Alert tone="danger" message={errorMessage(place.error)} /> : null}
      <Text variant="small">You can cancel until the restaurant accepts your order.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  address: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.raise,
    alignItems: 'center',
    justifyContent: 'center',
  },
  change: { fontFamily: fonts.sans700, color: colors.brandSoft, fontSize: 14 },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.card,
  },
  methodOn: { borderWidth: 2, borderColor: colors.brand },
});
