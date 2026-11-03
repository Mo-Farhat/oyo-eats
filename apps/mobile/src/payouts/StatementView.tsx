import { formatLkr, type SettlementDetail, type SettlementSummary } from '@oyo/shared';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card, Chip, Icon, Text } from '@/components';
import { colors } from '@/theme/tokens';

export const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const STATUS = {
  draft: { label: 'Being prepared', tone: 'neutral' },
  reviewed: { label: 'Checked, paying soon', tone: 'warn' },
  paid: { label: 'Paid', tone: 'green' },
} as const;

/** One statement in a list (period, total, status). */
export function StatementRow({ s, onPress }: { s: SettlementSummary; onPress: () => void }) {
  const st = STATUS[s.status];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="strong">{`${day(s.periodStart)} – ${day(s.periodEnd)}`}</Text>
        <Text variant="small">{`${s.lineCount} ${s.party === 'rider' ? 'deliveries' : 'orders'}`}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text variant="strong">{formatLkr(s.totalCents)}</Text>
        <Chip label={st.label} tone={st.tone} />
      </View>
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

/** A statement's lines and total, read-only. */
export function StatementLines({ d }: { d: SettlementDetail }) {
  const st = STATUS[d.status];
  return (
    <>
      <Card style={{ alignItems: 'center', gap: 4 }}>
        <Text variant="label">{`${day(d.periodStart)} – ${day(d.periodEnd)}`}</Text>
        <Text variant="big">{formatLkr(d.totalCents)}</Text>
        <Chip label={st.label} tone={st.tone} />
        {d.paidAt ? (
          <Text variant="small">{`Paid ${new Date(d.paidAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo' })}`}</Text>
        ) : null}
      </Card>
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        {d.lines.map((l, i) => (
          <View key={i} style={styles.line}>
            <Text variant="body" style={{ flex: 1 }}>
              {l.description}
            </Text>
            <Text variant="strong">{formatLkr(l.amountCents)}</Text>
          </View>
        ))}
        <View style={[styles.line, { borderTopColor: colors.control }]}>
          <Text variant="strong" style={{ flex: 1 }}>
            Total
          </Text>
          <Text variant="h3">{formatLkr(d.totalCents)}</Text>
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
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
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
