import { formatLkr, type MenuChangeRequest } from '@oyo/shared';
import { StyleSheet, View } from 'react-native';
import { Card, Chip, Text } from '@/components';
import { colors, fonts } from '@/theme/tokens';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

/** What changed, as short lines: "Price LKR 1,350 → LKR 1,450". */
export function changeLines(r: MenuChangeRequest): string[] {
  if (r.kind === 'new_item') {
    return [
      `New item · ${formatLkr(r.after.priceCents)} · ${r.after.categoryName}`,
      ...r.groups.map(
        (g) => `${g.name} (${g.required ? 'required' : 'optional'}): ${g.options.join(', ')}`,
      ),
    ];
  }
  const b = r.before!;
  const a = r.after;
  return [
    a.name !== b.name ? `Name: ${b.name} → ${a.name}` : null,
    a.priceCents !== b.priceCents
      ? `Price ${formatLkr(b.priceCents)} → ${formatLkr(a.priceCents)}`
      : null,
    a.description !== b.description ? `Description: ${a.description || '(none)'}` : null,
    a.categoryName !== b.categoryName ? `Category: ${b.categoryName} → ${a.categoryName}` : null,
  ].filter((x): x is string => !!x);
}

const STATUS = {
  pending: { label: 'Pending', tone: 'warn', card: 'warn' },
  approved: { label: 'Approved', tone: 'green', card: 'default' },
  rejected: { label: 'Rejected', tone: 'danger', card: 'danger' },
} as const;

/** One change request (T09 for the restaurant, A15 for the owner). */
export function RequestCard({
  r,
  showRestaurant,
  children,
}: {
  r: MenuChangeRequest;
  showRestaurant?: boolean;
  children?: React.ReactNode;
}) {
  const s = STATUS[r.status];
  const priceOnly = r.kind === 'edit' && r.before && r.after.priceCents !== r.before.priceCents;
  return (
    <Card tone={s.card} style={{ gap: 6 }}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <Text variant="strong">{r.itemName}</Text>
          <Text variant="small">
            {[showRestaurant ? r.restaurantName : null, `sent ${when(r.createdAt)}`]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Chip
          label={r.kind === 'new_item' && r.status === 'pending' ? 'New item' : s.label}
          tone={s.tone}
        />
      </View>
      {showRestaurant && priceOnly ? (
        <View style={styles.diff}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="small">Live now</Text>
            <Text style={styles.was}>{formatLkr(r.before!.priceCents)}</Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="small">Requested</Text>
            <Text style={styles.now}>{formatLkr(r.after.priceCents)}</Text>
          </View>
        </View>
      ) : null}
      {changeLines(r)
        .filter((l) => !(showRestaurant && priceOnly && l.startsWith('Price')))
        .map((l) => (
          <Text key={l} variant="small">
            {l}
          </Text>
        ))}
      {r.adminNote ? (
        <Text
          variant="small"
          style={{ color: r.status === 'rejected' ? colors.danger : colors.body }}
        >
          {`Oyo Eats: “${r.adminNote}”`}
        </Text>
      ) : null}
      {r.reviewedAt && r.status === 'approved' ? (
        <Text variant="small">{`Live since ${when(r.reviewedAt)}`}</Text>
      ) : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  diff: { flexDirection: 'row', gap: 8 },
  was: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.dangerTint,
    color: colors.body,
    textDecorationLine: 'line-through',
    fontFamily: fonts.sans600,
  },
  now: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.brandTint,
    color: colors.strong,
    fontFamily: fonts.sans700,
  },
});
