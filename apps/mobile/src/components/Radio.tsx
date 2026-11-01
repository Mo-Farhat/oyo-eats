import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';

/** The design's round radio (visual only; put it inside a pressable row). */
export function Radio({ on }: { on: boolean }) {
  return <View style={[styles.radio, on && styles.on]} />;
}

const styles = StyleSheet.create({
  radio: { width: 22, height: 22, borderRadius: 9999, borderWidth: 2, borderColor: colors.control },
  on: { borderWidth: 7, borderColor: colors.brand },
});
