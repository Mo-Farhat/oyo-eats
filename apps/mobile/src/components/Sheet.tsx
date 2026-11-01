import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';

/** Bottom sheet over a dark scrim (C05 item sheet, confirmations). Tapping the scrim closes it. */
export function Sheet({
  visible,
  onClose,
  children,
  footer,
  tall,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  tall?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <View
          style={[
            styles.sheet,
            tall && styles.tall,
            { paddingBottom: Math.max(24, insets.bottom + 12) },
          ]}
        >
          <View style={styles.grab} />
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 14,
    maxHeight: '90%',
  },
  tall: { height: '88%' },
  grab: {
    width: 40,
    height: 4,
    borderRadius: 4,
    backgroundColor: colors.idle,
    alignSelf: 'center',
  },
  body: { gap: 14, paddingBottom: 4 },
});
