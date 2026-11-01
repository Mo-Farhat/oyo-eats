import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';

/** The design's switch (52x30, green when on). */
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={8}
    >
      <View style={[styles.track, value && styles.on]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 52,
    height: 30,
    borderRadius: 9999,
    backgroundColor: colors.idle,
    justifyContent: 'center',
  },
  on: { backgroundColor: colors.brand },
  knob: { width: 24, height: 24, borderRadius: 9999, backgroundColor: '#ffffff', marginLeft: 3 },
  knobOn: { marginLeft: 25 },
});
