import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { Chip } from './Chip';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** A row in a More menu: icon, label, hint, optional count, chevron. */
export function LinkRow({
  icon,
  label,
  hint,
  count,
  href,
}: {
  icon: IconName;
  label: string;
  hint: string;
  count?: number;
  href: Href;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${label}, ${count} waiting` : label}
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <Icon name={icon} />
      <View style={{ flex: 1 }}>
        <Text variant="strong">{label}</Text>
        <Text variant="small">{hint}</Text>
      </View>
      {count ? <Chip tone="warn" label={String(count)} /> : null}
      <Icon name="chevron" size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
