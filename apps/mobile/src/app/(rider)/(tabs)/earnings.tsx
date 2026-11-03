import { formatLkr } from '@oyo/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { riderApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Card, Screen, Text } from '@/components';
import { StatementRow } from '@/payouts/StatementView';
import { colors, fonts } from '@/theme/tokens';

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={styles.stat}>
      <Text variant="small">{label}</Text>
      <Text style={styles.value}>{value}</Text>
      <Text variant="small">{sub}</Text>
    </View>
  );
}

/** R10: pay per delivery (fixed on the offer), what's owed, and weekly payouts. */
export default function Earnings() {
  const e = useQuery({
    queryKey: ['rider-earnings'],
    queryFn: riderApi.earnings,
    refetchInterval: 60_000,
  });
  const d = e.data;
  return (
    <Screen inTabs bodyStyle={{ gap: 12, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Earnings
      </Text>
      {e.error ? <Alert tone="danger" message={errorMessage(e.error)} /> : null}
      {d ? (
        <>
          <View style={styles.stats}>
            <Stat
              label="Today"
              value={formatLkr(d.today.payCents)}
              sub={`${d.today.deliveries} deliveries`}
            />
            <Stat
              label="This week"
              value={formatLkr(d.week.payCents)}
              sub={`${d.week.deliveries} deliveries`}
            />
          </View>
          <Card style={{ gap: 4 }}>
            <Text variant="strong">{`Owed to you: ${formatLkr(d.owedCents)}`}</Text>
            <Text variant="small">
              Paid weekly, for Monday to Sunday. Cash you hold is separate (Cash tab).
            </Text>
          </Card>
          {d.recent.length ? <Text variant="label">Recent deliveries</Text> : null}
          {d.recent.map((r) => (
            <View key={r.orderId} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text variant="strong">{r.restaurantName}</Text>
                <Text variant="small">{`#${r.reference} · ${time(r.deliveredAt)}`}</Text>
              </View>
              <Text variant="strong">{formatLkr(r.payCents)}</Text>
            </View>
          ))}
          {d.payouts.length ? <Text variant="label">Payouts</Text> : null}
          {d.payouts.map((s) => (
            <StatementRow key={s.id} s={s} onPress={() => router.push(`/payout/${s.id}`)} />
          ))}
          {d.recent.length === 0 ? (
            <Text variant="muted">Your deliveries and pay show up here.</Text>
          ) : null}
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
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  value: { fontFamily: fonts.display700, fontSize: 22, color: colors.strong },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
