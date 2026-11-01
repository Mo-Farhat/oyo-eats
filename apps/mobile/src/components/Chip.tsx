import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, fonts } from '@/theme/tokens';

const TONES = {
  neutral: { bg: colors.raise, fg: colors.body },
  green: { bg: colors.brandTint, fg: colors.brandSoft },
  warn: { bg: colors.warnTint, fg: colors.warn },
  danger: { bg: colors.dangerTint, fg: colors.danger },
  info: { bg: colors.infoTint, fg: colors.info },
  on: { bg: colors.brand, fg: '#ffffff' },
} as const;

export function Chip({
  label,
  tone = 'neutral',
  style,
}: {
  label: string;
  tone?: keyof typeof TONES;
  style?: ViewStyle;
}) {
  const t = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }, style]}>
      <Text style={[styles.text, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  text: { fontFamily: fonts.sans700, fontSize: 12 },
});
