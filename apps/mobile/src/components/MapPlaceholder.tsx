import { StyleSheet, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';
import { colors } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';

/**
 * Grey street-grid panel from the design, with a pin in the middle. Stands in for Google Maps
 * until the API key exists (docs/NEEDS-YOU.md).
 */
export function MapPlaceholder({
  height,
  pin = 'home',
  children,
}: {
  height: number;
  pin?: IconName;
  children?: React.ReactNode;
}) {
  return (
    <View
      style={[styles.map, { height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox="0 0 390 420"
        preserveAspectRatio="xMidYMid slice"
      >
        {Array.from({ length: 18 }, (_, i) => (
          <Line
            key={`v${i}`}
            x1={i * 24}
            y1={0}
            x2={i * 24}
            y2={420}
            stroke={i % 4 === 0 ? '#262a31' : '#22262c'}
            strokeWidth={i % 4 === 0 ? 2 : 1}
          />
        ))}
        {Array.from({ length: 18 }, (_, i) => (
          <Line
            key={`h${i}`}
            x1={0}
            y1={i * 24}
            x2={390}
            y2={i * 24}
            stroke={i % 4 === 0 ? '#262a31' : '#22262c'}
            strokeWidth={i % 4 === 0 ? 2 : 1}
          />
        ))}
        <Path
          d="M-10 300 C 80 260, 140 250, 200 210 S 330 120, 400 110"
          stroke="#3a414b"
          strokeWidth={14}
          fill="none"
        />
        <Path d="M120 -10 L 170 430" stroke="#30363f" strokeWidth={10} fill="none" />
      </Svg>
      <View style={styles.pin}>
        <Icon name={pin} color="#ffffff" />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  map: {
    backgroundColor: '#1c1f24',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pin: {
    width: 44,
    height: 44,
    borderRadius: 9999,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.page,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
