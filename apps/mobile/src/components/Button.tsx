import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
} from 'react-native';
import { colors, radius, type } from '@/theme/tokens';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.brand, fg: colors.onBrand },
  secondary: { bg: colors.page, fg: colors.strong, border: colors.control },
  danger: { bg: colors.dangerFill, fg: '#ffffff' },
  ghost: { bg: 'transparent', fg: colors.brandSoft },
};

export interface ButtonProps extends Omit<PressableProps, 'children'> {
  label: string;
  variant?: Variant;
  small?: boolean;
  loading?: boolean;
  /** Content after the label, e.g. a total on a cart button. */
  trailing?: React.ReactNode;
}

export function Button({
  label,
  variant = 'primary',
  small,
  loading,
  trailing,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const v = VARIANTS[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      style={(state) => [
        styles.base,
        small || variant === 'ghost' ? styles.small : styles.full,
        { backgroundColor: v.bg, borderColor: v.border ?? v.bg, borderWidth: v.border ? 1 : 0 },
        (state.pressed || off) && { opacity: off ? 0.5 : 0.9 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={[styles.content, trailing ? styles.spread : null]}>
          <Text
            style={[
              type.button,
              { color: v.fg },
              (small || variant === 'ghost') && styles.smallText,
            ]}
          >
            {label}
          </Text>
          {trailing}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  full: { minHeight: 52, alignSelf: 'stretch' },
  small: { minHeight: 44, paddingHorizontal: 14, alignSelf: 'flex-start' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spread: { flex: 1, justifyContent: 'space-between' },
  smallText: { fontSize: 15 },
});
