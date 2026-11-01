import { formatLkr } from '@oyo/shared';
import { StyleSheet, View } from 'react-native';
import { Alert, Card, Screen, Text } from '@/components';
import { useRiderState } from '@/rider/queries';
import { colors } from '@/theme/tokens';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

/** R11: cash on hand against the cap, and handovers the office recorded (RID-12). */
export default function Cash() {
  const s = useRiderState().data;
  const held = s?.cashHeldCents ?? 0;
  const cap = s?.cashCapCents ?? 0;
  const atCap = cap > 0 && held >= cap;
  return (
    <Screen inTabs bodyStyle={{ gap: 14, paddingTop: 24 }}>
      <Text variant="h1" accessibilityRole="header">
        Cash on Hand
      </Text>
      <Card tone={atCap ? 'danger' : 'default'} style={{ alignItems: 'center', gap: 4 }}>
        <Text variant="big">{formatLkr(held)}</Text>
        {cap ? (
          <Text variant="small">{`Cap ${formatLkr(cap)} · hand cash to the office before you reach it`}</Text>
        ) : null}
      </Card>
      {atCap ? (
        <Alert
          tone="danger"
          message="You're at the cash cap. Hand cash to the office to get cash orders again."
        />
      ) : null}

      <Text variant="h3">Handovers</Text>
      {s && s.handovers.length === 0 ? (
        <Text variant="muted">None yet. The office records each handover here.</Text>
      ) : null}
      {s?.handovers.map((h) => {
        const diff = h.amountCents - h.expectedCents;
        return (
          <Card key={h.id} style={{ gap: 4 }}>
            <View style={styles.between}>
              <Text variant="strong">{formatLkr(h.amountCents)}</Text>
              <Text variant="small">{when(h.recordedAt)}</Text>
            </View>
            <Text variant="small">{`Received by ${h.recordedBy}`}</Text>
            {diff ? (
              <Text variant="small" style={{ color: diff < 0 ? colors.danger : colors.warn }}>
                {`${diff < 0 ? 'Short' : 'Over'} by ${formatLkr(Math.abs(diff))}${h.varianceReason ? `: ${h.varianceReason}` : ''}${h.countersignedBy ? ' · signed off' : ''}`}
              </Text>
            ) : null}
          </Card>
        );
      })}
      <Text variant="small">
        Something wrong with a handover? Call the office before your next shift.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
