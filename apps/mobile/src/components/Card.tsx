import { StyleSheet, View, type ViewProps } from 'react-native';
import { colors } from '@/theme/tokens';

const BORDERS = {
  default: colors.border,
  green: colors.brand,
  warn: '#8a6a2a',
  danger: '#8a3b3e',
} as const;

export function Card({
  tone = 'default',
  style,
  ...props
}: ViewProps & { tone?: keyof typeof BORDERS }) {
  return <View {...props} style={[styles.card, { borderColor: BORDERS[tone] }, style]} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
});
