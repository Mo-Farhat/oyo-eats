import { formatLkr } from '@oyo/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { restaurantApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, IconButton, Screen, Segmented, Text } from '@/components';
import { colors, fonts } from '@/theme/tokens';

const colomboDate = (offsetDays = 0) =>
  new Date(Date.now() + 330 * 60_000 - offsetDays * 86_400_000).toISOString().slice(0, 10);
const RANGES = { today: 0, week: 6, month: 29 } as const;
type Range = keyof typeof RANGES;
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
const time = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });
const STATUS: Record<string, string> = {
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
  failed: 'Failed',
  active: 'In progress',
  picked_up: 'On the way',
  awaiting_restaurant: 'New',
};

/** T12 (RES-13): orders and daily sales, today, 7 or 30 days, with CSV export. */
export default function Sales() {
  const [range, setRange] = useState<Range>('week');
  const from = colomboDate(RANGES[range]);
  const to = colomboDate();
  const h = useQuery({
    queryKey: ['restaurant-history', from, to],
    queryFn: () => restaurantApi.history(from, to),
  });
  const share = useMutation({
    mutationFn: async () => Share.share({ message: await restaurantApi.historyCsv(from, to) }),
  });
  const d = h.data;
  return (
    <Screen
      top={
        <>
          <IconButton
            icon="back"
            label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
          />
          <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
            Sales and History
          </Text>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      <Segmented
        options={[
          { value: 'today', label: 'Today' },
          { value: 'week', label: '7 days' },
          { value: 'month', label: '30 days' },
        ]}
        value={range}
        onChange={setRange}
      />
      {h.error || share.error ? (
        <Alert tone="danger" message={errorMessage(h.error ?? share.error)} />
      ) : null}
      {d ? (
        <>
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text variant="small">Food sales</Text>
              <Text style={styles.value}>{formatLkr(d.totals.salesCents)}</Text>
            </View>
            <View style={styles.stat}>
              <Text variant="small">Delivered</Text>
              <Text style={styles.value}>{String(d.totals.delivered)}</Text>
            </View>
            <View style={styles.stat}>
              <Text variant="small">Cancelled</Text>
              <Text style={styles.value}>{String(d.totals.cancelled)}</Text>
            </View>
          </View>
          {range !== 'today' ? (
            <Card style={{ gap: 0, paddingVertical: 6 }}>
              {d.days.map((day) => (
                <View key={day.date} style={styles.line}>
                  <Text variant="body" style={{ flex: 1 }}>
                    {dayLabel(day.date)}
                  </Text>
                  <Text variant="small" style={{ width: 70 }}>{`${day.delivered} orders`}</Text>
                  <Text variant="strong" style={{ width: 100, textAlign: 'right' }}>
                    {formatLkr(day.salesCents)}
                  </Text>
                </View>
              ))}
            </Card>
          ) : null}
          <Text variant="label">Orders</Text>
          {d.orders.map((o) => (
            <View key={o.id} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text variant="strong">{`#${o.reference}`}</Text>
                <Text variant="small">{`${time(o.placedAt)} · ${o.itemCount} ${o.itemCount === 1 ? 'item' : 'items'} · ${o.paymentMethod === 'cod' ? 'cash' : 'paid'}`}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="strong">{formatLkr(o.salesCents)}</Text>
                <Text variant="small">{STATUS[o.status] ?? o.status}</Text>
              </View>
            </View>
          ))}
          {d.orders.length === 0 ? <Text variant="muted">No orders in this period.</Text> : null}
          <Button
            variant="secondary"
            label="Share as CSV"
            loading={share.isPending}
            onPress={() => share.mutate()}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    gap: 2,
    padding: 10,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  value: { fontFamily: fonts.display700, fontSize: 18, color: colors.strong },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
