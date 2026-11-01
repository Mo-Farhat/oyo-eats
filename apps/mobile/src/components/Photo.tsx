import { StyleSheet, View, type ViewStyle } from 'react-native';
import { colors } from '@/theme/tokens';
import { Icon } from './Icon';

/** Photo slot. Shows the placeholder until menu photos exist (RES-08). */
export function Photo({ size, style }: { size?: number; style?: ViewStyle }) {
  return (
    <View
      style={[styles.photo, size ? { width: size, height: size } : null, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Icon name="image" color="#6b7483" />
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    backgroundColor: colors.photo,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
