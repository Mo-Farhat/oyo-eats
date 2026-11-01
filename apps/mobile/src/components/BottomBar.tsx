import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';

/** Sticky action bar under a screen's body (cart, checkout). */
export function BottomBar({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(20, insets.bottom + 8) }]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingTop: 12,
    paddingHorizontal: 20,
    backgroundColor: colors.bar,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
});
