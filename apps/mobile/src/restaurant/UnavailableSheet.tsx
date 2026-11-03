import { formatLkr, substituteAllowed, type RestaurantOrder } from '@oyo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Checkbox, Radio, Sheet, Stepper, Text } from '@/components';
import { BOARD, useMenu } from '@/restaurant/queries';
import { colors } from '@/theme/tokens';

type Line = RestaurantOrder['lines'][number];

/**
 * RES-05: part of a line can't be made. The kitchen says how many it can still make and may offer
 * a plain substitute from its menu; the customer then swaps or removes the rest.
 */
export function UnavailableSheet({
  order,
  line,
  onClose,
}: {
  order: RestaurantOrder;
  line: Line | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const menu = useMenu();
  const [available, setAvailable] = useState(0);
  const [substitute, setSubstitute] = useState<string | null>(null);
  const [soldOut, setSoldOut] = useState(false);
  useEffect(() => {
    setAvailable(0);
    setSubstitute(null);
    setSoldOut(false);
  }, [line?.id]);

  const mark = useMutation({
    mutationFn: () =>
      restaurantApi.unavailable(order.id, {
        orderItemId: line!.id,
        availableQuantity: available,
        substituteMenuItemId: substitute ?? undefined,
        markSoldOut: soldOut,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BOARD });
      onClose();
    },
  });

  if (!line) return null;
  const missing = line.quantity - available;
  // A substitute is ordered plain: live, in stock, no required choices, not the same dish.
  const options = (menu.data?.categories ?? [])
    .flatMap((c) => c.items)
    .filter(
      (i) =>
        i.status === 'live' &&
        !i.soldOut &&
        i.id !== line.menuItemId &&
        i.groups.every((g) => g.minSelect === 0),
    )
    .map((i) => ({
      ...i,
      allowed: substituteAllowed(order.paymentMethod, line, available, i.priceCents),
    }));

  return (
    <Sheet visible onClose={onClose}>
      <View style={{ gap: 4 }}>
        <Text variant="h2">{`Can't make ${line.name}?`}</Text>
        <Text variant="muted">
          {substitute
            ? `${order.customerFirstName} chooses: take the substitute or remove it. No answer in a few minutes removes it.`
            : `It comes off the order and ${order.customerFirstName} is told right away.`}
        </Text>
      </View>
      {line.quantity > 1 ? (
        <View style={styles.between}>
          <Text style={{ flex: 1 }}>{`How many can you still make? (of ${line.quantity})`}</Text>
          <Stepper
            label="How many you can make"
            value={available}
            min={0}
            max={line.quantity - 1}
            onChange={(v) => setAvailable(Math.max(0, Math.min(line.quantity - 1, v)))}
          />
        </View>
      ) : null}
      <Text variant="label">{`Offer instead (${missing} ×)`}</Text>
      <ScrollView style={{ maxHeight: 260 }} nestedScrollEnabled>
        {[
          { id: null, name: 'No substitute: remove it', priceCents: 0, allowed: true },
          ...options,
        ].map((o) => (
          <Pressable
            key={o.id ?? 'none'}
            accessibilityRole="radio"
            accessibilityState={{ checked: substitute === o.id, disabled: !o.allowed }}
            disabled={!o.allowed}
            onPress={() => setSubstitute(o.id)}
            style={[styles.option, !o.allowed && { opacity: 0.4 }]}
          >
            <Radio on={substitute === o.id} />
            <Text style={{ flex: 1 }}>{o.name}</Text>
            {o.id ? (
              <Text variant="small">
                {o.allowed ? formatLkr(o.priceCents) : 'Costs more than paid'}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
      <Checkbox
        label={`Mark ${line.name} sold out`}
        checked={soldOut}
        onChange={() => setSoldOut(!soldOut)}
      >
        <Text>{`Mark ${line.name} sold out on the menu`}</Text>
      </Checkbox>
      {mark.error ? <Alert tone="danger" message={errorMessage(mark.error)} /> : null}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label="Back" onPress={onClose} />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            label={substitute ? 'Ask the Customer' : 'Remove It'}
            loading={mark.isPending}
            onPress={() => mark.mutate()}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
