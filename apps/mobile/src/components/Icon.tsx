import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme/tokens';

// Stroke icons as drawn in the design canvas (24x24, 2px stroke, round caps).
const ICONS = {
  back: <Path d="m15 18-6-6 6-6" />,
  eye: (
    <>
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <Path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
    </>
  ),
  lock: (
    <>
      <Rect x="3" y="11" width="18" height="11" rx="2" />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  check: <Path d="M20 6 9 17l-5-5" />,
  copy: (
    <>
      <Rect x="9" y="9" width="13" height="13" rx="2" />
      <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  home: <Path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="8" />
      <Path d="m21 21-4.3-4.3" />
    </>
  ),
  list: <Path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  user: (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  scooter: (
    <>
      <Circle cx="5.5" cy="17.5" r="3.5" />
      <Circle cx="18.5" cy="17.5" r="3.5" />
      <Path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2" />
    </>
  ),
  alert: (
    <Path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  ),
  logout: <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  pin: (
    <>
      <Path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <Circle cx="12" cy="10" r="3" />
    </>
  ),
  locate: <Path d="m3 11 19-9-9 19-2-8z" />,
  bell: (
    <>
      <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <Path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  star: <Path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />,
  image: (
    <>
      <Rect x="3" y="3" width="18" height="18" rx="2" />
      <Circle cx="9" cy="9" r="2" />
      <Path d="m21 15-5-5L5 21" />
    </>
  ),
  plus: <Path d="M12 5v14M5 12h14" />,
  minus: <Path d="M5 12h14" />,
  close: <Path d="M18 6 6 18M6 6l12 12" />,
  chevron: <Path d="m9 18 6-6-6-6" />,
  cash: (
    <>
      <Rect x="2" y="6" width="20" height="12" rx="2" />
      <Circle cx="12" cy="12" r="2" />
    </>
  ),
  bank: <Path d="M3 21h18M5 21V10M19 21V10M9 21v-8M15 21v-8M2 10l10-7 10 7z" />,
  cart: (
    <>
      <Circle cx="9" cy="20" r="1.5" />
      <Circle cx="18" cy="20" r="1.5" />
      <Path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 7H6" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color = colors.strong,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </Svg>
  );
}
