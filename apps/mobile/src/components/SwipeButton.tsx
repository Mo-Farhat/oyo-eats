import { useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { colors, fonts } from '@/theme/tokens';
import { Icon } from './Icon';

const KNOB = 52;

/**
 * Swipe to confirm (section 5): riders change job status only by sliding the knob all the way,
 * so a stray tap can't advance a job. Screen readers get a plain button action instead.
 */
export function SwipeButton({
  label,
  onConfirm,
  disabled,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const x = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);
  const max = Math.max(0, width - KNOB - 8);
  const maxRef = useRef(0);
  maxRef.current = max;

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => x.setValue(Math.max(0, Math.min(maxRef.current, g.dx))),
      onPanResponderRelease: (_, g) => {
        if (g.dx >= maxRef.current * 0.9 && maxRef.current > 0) {
          Animated.timing(x, {
            toValue: maxRef.current,
            duration: 80,
            useNativeDriver: false,
          }).start(() => {
            onConfirmRef.current();
            x.setValue(0);
          });
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
        }
      },
    }),
  ).current;
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => !disabled && onConfirm()}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, disabled && { opacity: 0.45 }]}
      testID="swipe-track"
    >
      <Text style={styles.label}>{label}</Text>
      <Animated.View
        {...(disabled ? {} : responder.panHandlers)}
        style={[styles.knob, { transform: [{ translateX: x }] }]}
        testID="swipe-knob"
      >
        <Icon name="chevron" color="#ffffff" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 60,
    borderRadius: 9999,
    backgroundColor: colors.brandTint,
    borderWidth: 1,
    borderColor: colors.brand,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: { fontFamily: fonts.display700, fontSize: 16, color: colors.brandSoft },
  knob: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: KNOB,
    height: KNOB,
    borderRadius: 9999,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
