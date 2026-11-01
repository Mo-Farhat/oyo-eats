/*
 * Design tokens from the design canvas (project/ds/oyo-eats/tokens.json and project/oyo-app.css).
 * Dark theme only. Use these instead of raw values in components and screens.
 */
export const colors = {
  brand: '#648402', // avocado green: primary fills, tiles, active states
  onBrand: '#ffffff',
  brandSoft: '#b5d35a', // green for small text (brand fails 4.5:1 under 24px)
  brandTint: 'rgba(100,132,2,0.18)',
  accent: '#f97316', // only the "Eats" in the wordmark
  bar: '#111113',
  page: '#18191b',
  card: '#191c21',
  panel: '#121214',
  raise: '#23272e',
  photo: '#2a2f36',
  border: '#212830',
  control: '#6b7280', // control borders (3:1+)
  idle: '#4a5565',
  strong: '#ffffff',
  body: '#d1d5dc',
  muted: '#99a1af',
  warn: '#f5b544',
  warnTint: 'rgba(245,165,36,0.16)',
  danger: '#ff8a8d',
  dangerFill: '#b42318',
  dangerTint: 'rgba(229,72,77,0.16)',
  info: '#8fb6ff',
  infoTint: 'rgba(80,140,255,0.16)',
} as const;

export const radius = { button: 8, tile: 12, stat: 16, card: 24, pill: 9999 } as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;

/** Loaded in the root layout. React Native picks weights by family name, not fontWeight. */
export const fonts = {
  display600: 'Poppins_600SemiBold',
  display700: 'Poppins_700Bold',
  display800: 'Poppins_800ExtraBold',
  sans400: 'OpenSans_400Regular',
  sans600: 'OpenSans_600SemiBold',
  sans700: 'OpenSans_700Bold',
} as const;

export const type = {
  h1: { fontFamily: fonts.display800, fontSize: 28, lineHeight: 34, color: colors.strong },
  h2: { fontFamily: fonts.display700, fontSize: 20, lineHeight: 28, color: colors.strong },
  h3: { fontFamily: fonts.display700, fontSize: 16, lineHeight: 22, color: colors.strong },
  big: { fontFamily: fonts.display600, fontSize: 30, lineHeight: 36, color: colors.strong },
  wordmark: { fontFamily: fonts.display700, fontSize: 24, lineHeight: 32, color: colors.strong },
  button: { fontFamily: fonts.display700, fontSize: 18, letterSpacing: -0.36 },
  lede: { fontFamily: fonts.sans400, fontSize: 16, lineHeight: 26, color: colors.body },
  body: { fontFamily: fonts.sans400, fontSize: 14, lineHeight: 20, color: colors.body },
  strong: { fontFamily: fonts.sans600, fontSize: 14, lineHeight: 20, color: colors.strong },
  muted: { fontFamily: fonts.sans400, fontSize: 13, lineHeight: 19, color: colors.muted },
  small: { fontFamily: fonts.sans400, fontSize: 12, lineHeight: 17, color: colors.muted },
  label: { fontFamily: fonts.sans600, fontSize: 13, lineHeight: 18, color: colors.muted },
} as const;
