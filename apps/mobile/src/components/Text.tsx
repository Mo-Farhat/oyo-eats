import { Text as RNText, type TextProps } from 'react-native';
import { type } from '@/theme/tokens';

type Variant = keyof typeof type;

/** Text in one of the design's type styles. Defaults to body. */
export function Text({ variant = 'body', style, ...props }: TextProps & { variant?: Variant }) {
  return <RNText {...props} style={[type[variant], style]} />;
}
