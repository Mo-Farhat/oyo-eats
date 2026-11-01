import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/theme/tokens';

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.seg} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.item, on && styles.on]}
          >
            <Text style={[styles.text, on && { color: colors.strong }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  seg: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.bar,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 4,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  on: { backgroundColor: colors.raise },
  text: { fontFamily: fonts.sans700, fontSize: 13, color: colors.muted },
});
