import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme/tokens';
import { Icon } from './Icon';

const TONES = {
  warn: { bg: colors.warnTint, fg: colors.warn },
  danger: { bg: colors.dangerTint, fg: colors.danger },
  green: { bg: colors.brandTint, fg: colors.brandSoft },
  info: { bg: colors.infoTint, fg: colors.info },
} as const;

/** Inline message. Announced to screen readers when it appears. */
export function Alert({ message, tone = 'warn' }: { message: string; tone?: keyof typeof TONES }) {
  const t = TONES[tone];
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.alert, { backgroundColor: t.bg }]}
    >
      <Icon name="alert" size={16} color={t.fg} />
      <Text style={[styles.text, { color: t.fg }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  alert: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  text: { flex: 1, fontFamily: fonts.sans600, fontSize: 13, lineHeight: 18 },
});
