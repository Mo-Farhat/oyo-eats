import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, fonts, type } from '@/theme/tokens';
import { IconButton } from './IconButton';

export interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string;
  /** Fixed text before the input, e.g. "+94". */
  prefix?: string;
  /** Password field with a show/hide button. */
  secret?: boolean;
}

export function TextField({ label, hint, error, prefix, secret, style, ...props }: TextFieldProps) {
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={type.label}>{label}</Text>
      <View style={styles.row}>
        {prefix ? (
          <View style={[styles.input, styles.prefix]}>
            <Text style={styles.prefixText}>{prefix}</Text>
          </View>
        ) : null}
        <View style={styles.grow}>
          <TextInput
            {...props}
            accessibilityLabel={label}
            placeholderTextColor={colors.idle}
            secureTextEntry={secret && !shown}
            autoCapitalize={secret ? 'none' : props.autoCapitalize}
            autoCorrect={secret ? false : props.autoCorrect}
            onFocus={(e) => {
              setFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              props.onBlur?.(e);
            }}
            style={[
              styles.input,
              focused && styles.focused,
              error ? styles.errored : null,
              secret && styles.withButton,
              style,
            ]}
          />
          {secret ? (
            <View style={styles.toggle}>
              <IconButton
                icon={shown ? 'eyeOff' : 'eye'}
                label={shown ? 'Hide password' : 'Show password'}
                onPress={() => setShown(!shown)}
              />
            </View>
          ) : null}
        </View>
      </View>
      {error ? (
        <Text style={[type.small, { color: colors.danger }]}>{error}</Text>
      ) : hint ? (
        <Text style={type.small}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1 },
  input: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.control,
    backgroundColor: colors.bar,
    color: colors.strong,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fonts.sans400,
  },
  prefix: { width: 84, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0 },
  prefixText: { color: colors.strong, fontFamily: fonts.sans600, fontSize: 16 },
  focused: { borderColor: colors.strong, borderWidth: 2 },
  errored: { borderColor: colors.danger },
  withButton: { paddingRight: 52 },
  toggle: { position: 'absolute', right: 4, top: 4 },
});
