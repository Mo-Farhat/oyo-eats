import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme/tokens';
import { Icon } from './Icon';

/** − n + quantity control. Going below `min` calls onChange with `min - 1` (e.g. 0 to remove). */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 50,
  compact,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  compact?: boolean;
  label: string;
}) {
  const size = compact ? 34 : 38;
  return (
    <View
      style={[styles.stepper, { height: size + 2 }]}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ now: value, min, max }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Less ${label}`}
        onPress={() => onChange(value - 1)}
        disabled={value < min}
        style={[styles.btn, { width: size, height: size }]}
      >
        <Icon name="minus" size={16} />
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More ${label}`}
        onPress={() => onChange(value + 1)}
        disabled={value >= max}
        style={[styles.btn, { width: size, height: size }, value >= max && { opacity: 0.4 }]}
      >
        <Icon name="plus" size={16} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.control,
    borderRadius: 8,
  },
  btn: { alignItems: 'center', justifyContent: 'center' },
  value: {
    minWidth: 20,
    textAlign: 'center',
    color: colors.strong,
    fontFamily: fonts.sans700,
    fontSize: 15,
  },
});
