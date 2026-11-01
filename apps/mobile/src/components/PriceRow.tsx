import { formatLkr } from '@oyo/shared';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme/tokens';

/** One line of a totals table; `total` is the bold last row with a rule above. */
export function PriceRow({
  label,
  cents,
  total,
}: {
  label: string;
  cents: number;
  total?: boolean;
}) {
  return (
    <View style={[styles.row, total && styles.total]}>
      <Text style={[styles.label, total && styles.strong]}>{label}</Text>
      <Text style={[styles.value, total && styles.strong]}>{formatLkr(cents)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  total: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 4 },
  label: { fontFamily: fonts.sans400, fontSize: 14, color: colors.body, flex: 1 },
  value: { fontFamily: fonts.sans600, fontSize: 14, color: colors.strong, flexShrink: 0 },
  strong: { fontFamily: fonts.sans700, fontSize: 16, color: colors.strong },
});
