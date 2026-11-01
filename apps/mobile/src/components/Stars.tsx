import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme/tokens';

const STAR = 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z';

/** 1–5 stars; pass onChange to make it a control (C12). */
export function Stars({
  value,
  onChange,
  size = 32,
  label,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  label: string;
}) {
  return (
    <View
      style={styles.row}
      accessibilityRole={onChange ? 'adjustable' : 'image'}
      accessibilityLabel={`${label}: ${value} of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= value;
        const star = (
          <Svg width={size} height={size} viewBox="0 0 24 24">
            <Path
              d={STAR}
              fill={on ? colors.warn : 'none'}
              stroke={on ? colors.warn : colors.idle}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </Svg>
        );
        return onChange ? (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
            onPress={() => onChange(n)}
            hitSlop={4}
          >
            {star}
          </Pressable>
        ) : (
          <View key={n}>{star}</View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 6 } });
