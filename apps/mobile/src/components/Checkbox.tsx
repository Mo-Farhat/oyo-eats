import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { Icon } from './Icon';

/** The design's square check; pass the label as children so the whole row is tappable. */
export function Checkbox({
  checked,
  onChange,
  children,
  label,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  children?: React.ReactNode;
  /** Read by screen readers. */
  label: string;
}) {
  const box = (
    <View style={[styles.check, checked && styles.on]}>
      {checked ? <Icon name="check" size={16} color="#ffffff" /> : null}
    </View>
  );
  if (!onChange) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        accessibilityState={{ checked }}
        style={styles.row}
      >
        {box}
        {children}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={styles.row}
    >
      {box}
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  on: { backgroundColor: colors.brand, borderColor: colors.brand },
});
