import { Pressable, StyleSheet } from 'react-native';
import { colors } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';

export function IconButton({
  icon,
  label,
  onPress,
  green,
}: {
  icon: IconName;
  /** Read by screen readers. */
  label: string;
  onPress?: () => void;
  green?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.ib, green && styles.green, pressed && { opacity: 0.8 }]}
    >
      <Icon name={icon} color={green ? '#ffffff' : colors.strong} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ib: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  green: { backgroundColor: colors.brand, borderColor: colors.brand },
});
