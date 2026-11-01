import { Text } from 'react-native';
import { colors, type } from '@/theme/tokens';

export function Wordmark({ size = 24 }: { size?: number }) {
  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel="Oyo Eats"
      style={[type.wordmark, { fontSize: size, lineHeight: size * 1.33 }]}
    >
      Oyo <Text style={{ color: colors.accent }}>Eats</Text>
    </Text>
  );
}
