import { formatLkr } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, IconButton, Screen, Segmented, Text } from '@/components';
import { colors, fonts } from '@/theme/tokens';

const colomboDate = (back = 0) =>
  new Date(Date.now() + 330 * 60_000 - back * 86_400_000).toISOString().slice(0, 10);
const RANGES = { today: 0, week: 6, month: 29 } as const;
type Range = keyof typeof RANGES;
const minutes = (m: number | null) => (m === null ? '—' : `${Math.round(m)} min`);
const REASON: Record<string, string> = {
  restaurant_timed_out: 'Restaurant didn’t respond',
  payment_expired: 'No bank slip in time',
  offer_declined: 'Rider declined (no reason)',
  cancelled_by_customer: 'Customer cancelled',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="small">{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="strong">{value}</Text>
    </View>
  );
}

/** PRD section 9, control 2: last night's books check, and run it again. */
function BooksCheck() {
  const queryClient = useQueryClient();
  const runs = useQuery({ queryKey: ['reconciliation'], queryFn: dispatchApi.reconciliation });
  const run = useMutation({
    mutationFn: dispatchApi.runReconciliation,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reconciliation'] }),
  });
  const last = runs.data?.[0];
  return (
    <Card tone={!last ? 'default' : last.ok ? 'green' : 'warn'} style={{ gap: 6 }}>
      <Text variant="strong">
        {!last
          ? 'Books check: not run yet'
          : last.ok
            ? `Books check: all agree (${last.forDate})`
            : `Books check: ${last.issues.length} ${last.issues.length === 1 ? 'difference' : 'differences'} (${last.forDate})`}
      </Text>
      {last && !last.ok
        ? last.issues.slice(0, 5).map((i, n) => (
            <Text key={n} variant="small">
              {`• ${i.message}`}
            </Text>
          ))
        : null}
      <Text variant="small">
        Runs every night at 03:30. Deliveries, transfers, cash and refunds against the ledger.
      </Text>
      {run.error ? <Alert tone="danger" message={errorMessage(run.error)} /> : null}
      <Button
        small
        variant="ghost"
        label="Check Yesterday Again"
        loading={run.isPending}
        onPress={() => run.mutate()}
      />
    </Card>
  );
}

/** A19 (ADM-17): orders, money, cash position, delivery times, failure reasons, restaurants, riders. */
export default function Reports() {
  const [range, setRange] = useState<Range>('week');
  const from = colomboDate(RANGES[range]);
  const to = colomboDate();
  const r = useQuery({
    queryKey: ['report', from, to],
    queryFn: () => dispatchApi.report(from, to),
  });
  const share = useMutation({
    mutationFn: async () => Share.share({ message: await dispatchApi.reportCsv(from, to) }),
  });
  const d = r.data;
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
            Reports
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
      <BooksCheck />
      {r.error || share.error ? (
        <Alert tone="danger" message={errorMessage(r.error ?? share.error)} />
      ) : null}
      {d ? (
        <>
          <View style={styles.stats}>
            <Stat label="Delivered" value={String(d.orders.delivered)} />
            <Stat label="Order value" value={formatLkr(d.money.grossCents)} />
            <Stat label="Avg delivery" value={minutes(d.times.avgDeliveryMinutes)} />
          </View>
          <Card style={styles.card}>
            <Text variant="label">Orders</Text>
            <Line label="Placed" value={String(d.orders.placed)} />
            <Line
              label="Cancelled / rejected / failed"
              value={`${d.orders.cancelled} / ${d.orders.rejected} / ${d.orders.failed}`}
            />
            <Line
              label="Cash / bank transfer"
              value={`${d.orders.cod} / ${d.orders.bankTransfer}`}
            />
            <Line label="Restaurant accepts in (avg)" value={minutes(d.times.avgAcceptMinutes)} />
            <Line label="Delivery time, slowest 10%" value={minutes(d.times.p90DeliveryMinutes)} />
          </Card>
          <Card style={styles.card}>
            <Text variant="label">Money</Text>
            <Line label="Delivery fee income" value={formatLkr(d.money.deliveryFeeCents)} />
            <Line label="Rider pay" value={formatLkr(d.money.riderPayCents)} />
            <Line label="Food (owed to restaurants)" value={formatLkr(d.money.foodCents)} />
            <Line label="Refunds issued" value={formatLkr(d.money.refundsCents)} />
          </Card>
          <Card style={styles.card}>
            <Text variant="label">Right now</Text>
            <Line label="Cash held by riders" value={formatLkr(d.position.cashWithRidersCents)} />
            <Line
              label="Owed to restaurants"
              value={formatLkr(d.position.owedToRestaurantsCents)}
            />
            <Line label="Owed to riders" value={formatLkr(d.position.owedToRidersCents)} />
            <Line
              label="Owed to customers (refunds)"
              value={formatLkr(d.position.owedToCustomersCents)}
            />
          </Card>
          {d.reasons.length ? (
            <Card style={styles.card}>
              <Text variant="label">Why orders didn’t go through</Text>
              {d.reasons.map((x) => (
                <Line key={x.reason} label={REASON[x.reason] ?? x.reason} value={String(x.count)} />
              ))}
            </Card>
          ) : null}
          {d.restaurants.length ? (
            <Card style={styles.card}>
              <Text variant="label">Restaurants</Text>
              {d.restaurants.map((x) => (
                <Line
                  key={x.id}
                  label={`${x.name}${x.rating ? ` · ${x.rating}★` : ''}`}
                  value={`${x.delivered} · ${formatLkr(x.foodCents)}${x.rejected ? ` · ${x.rejected} rejected` : ''}`}
                />
              ))}
            </Card>
          ) : null}
          {d.riders.length ? (
            <Card style={styles.card}>
              <Text variant="label">Riders</Text>
              {d.riders.map((x) => (
                <Line
                  key={x.id}
                  label={x.name}
                  value={`${x.delivered} · ${minutes(x.avgMinutes)}${x.declined ? ` · ${x.declined} declined` : ''}`}
                />
              ))}
            </Card>
          ) : null}
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
  value: { fontFamily: fonts.display700, fontSize: 17, color: colors.strong },
  card: { gap: 2 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
