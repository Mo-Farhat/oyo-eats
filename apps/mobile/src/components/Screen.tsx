import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors } from '@/theme/tokens';

/**
 * A full screen on the page surface. `top` is the header row (back button etc.), `footer` sits
 * under the scrolling body (e.g. the bottom nav). The body scrolls so large text never clips.
 */
export function Screen({
  top,
  footer,
  children,
  background = colors.page,
  bodyStyle,
  inTabs,
}: {
  top?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  background?: string;
  bodyStyle?: ViewProps['style'];
  /** Inside a tab navigator: the tab bar handles the bottom inset. */
  inTabs?: boolean;
}) {
  const edges: Edge[] = footer || inTabs ? ['top'] : ['top', 'bottom'];
  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: background }]}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {top ? <View style={styles.top}>{top}</View> : null}
        <ScrollView
          contentContainerStyle={[styles.body, !top && styles.noTop, bodyStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Pushes what follows to the bottom of a Screen body. */
export function Spacer() {
  return <View style={{ flex: 1 }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20, gap: 16 },
  noTop: { paddingTop: 24 },
});
