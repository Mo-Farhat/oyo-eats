import { formatLkr, type SettlementSummary } from '@oyo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { dispatchApi } from '@/api';
import { errorMessage } from '@/api/messages';
import { Alert, Button, Card, Chip, Icon, IconButton, Screen, Segmented, Text } from '@/components';
import { colors } from '@/theme/tokens';

type Party = 'restaurant' | 'rider';
const STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  reviewed: { label: 'Reviewed', tone: 'warn' },
  paid: { label: 'Paid', tone: 'green' },
} as const;

/** Monday of last week (Asia/Colombo): weekly cycles run Monday to Sunday (PRD section 9). */
export function lastWeekMonday(now = new Date()): string {
  const local = new Date(now.getTime() + 330 * 60_000);
  const back = ((local.getUTCDay() + 6) % 7) + 7;
  local.setUTCDate(local.getUTCDate() - back);
  return local.toISOString().slice(0, 10);
}
const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

function Row({ s }: { s: SettlementSummary }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/settlement/${s.id}`)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="strong">{s.partyName}</Text>
        <Text variant="small">{`${s.lineCount} ${s.party === 'rider' ? 'deliveries' : 'orders'}`}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text variant="strong">{formatLkr(s.totalCents)}</Text>
        <Chip label={STATUS[s.status].label} tone={STATUS[s.status].tone} />
      </View>
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** A16 restaurant statements and A17 rider payouts, by week (ADM-13, ADM-14). Owner only. */
export default function Settlements() {
  const params = useLocalSearchParams<{ party?: string }>();
  const [party, setParty] = useState<Party>(params.party === 'rider' ? 'rider' : 'restaurant');
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['settlements', party],
    queryFn: () => dispatchApi.settlements(party),
  });
  const week = lastWeekMonday();
  const generate = useMutation({
    mutationFn: () => dispatchApi.generateSettlements(party, week),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settlements', party] }),
  });
  const periods = new Map<string, SettlementSummary[]>();
  for (const s of list.data ?? []) {
    const k = `${s.periodStart}|${s.periodEnd}`;
    periods.set(k, [...(periods.get(k) ?? []), s]);
  }

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
            Settlements
          </Text>
        </>
      }
      bodyStyle={{ gap: 12 }}
    >
      <Segmented
        options={[
          { value: 'restaurant', label: 'Restaurants' },
          { value: 'rider', label: 'Riders' },
        ]}
        value={party}
        onChange={setParty}
      />
      <Card>
        <Text variant="strong">{`Last week · ${day(week)} – ${day(lastWeekSunday(week))}`}</Text>
        <Text variant="small">
          {party === 'restaurant'
            ? 'Food money owed to each restaurant for orders delivered that week. Each order is settled once.'
            : 'Delivery pay owed to each rider for that week, as fixed on each offer.'}
        </Text>
        <Button
          label={party === 'restaurant' ? 'Build Statements' : 'Build Payouts'}
          loading={generate.isPending}
          onPress={() => generate.mutate()}
        />
        {generate.data ? (
          <Text variant="small">
            {generate.data.length
              ? `${generate.data.length} draft${generate.data.length === 1 ? '' : 's'} ready to review.`
              : 'Nothing new to settle for that week.'}
          </Text>
        ) : null}
      </Card>
      {list.error || generate.error ? (
        <Alert tone="danger" message={errorMessage(list.error ?? generate.error)} />
      ) : null}
      {[...periods.entries()].map(([k, rows]) => {
        const [start, end] = k.split('|') as [string, string];
        const total = rows.reduce((n, r) => n + r.totalCents, 0);
        return (
          <View key={k} style={{ gap: 4 }}>
            <View style={styles.between}>
              <Text variant="label">{`${day(start)} – ${day(end)}`}</Text>
              <Text variant="label">{formatLkr(total)}</Text>
            </View>
            {rows.map((s) => (
              <Row key={s.id} s={s} />
            ))}
          </View>
        );
      })}
      {list.data && list.data.length === 0 ? (
        <Text variant="muted">No statements yet. Build last week’s above.</Text>
      ) : null}
    </Screen>
  );
}

function lastWeekSunday(monday: string) {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
});
