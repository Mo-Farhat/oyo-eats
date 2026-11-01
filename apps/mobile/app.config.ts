import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Adds the Google Maps SDK keys to app.json from apps/mobile/.env (git-ignored), so keys never
 * land in the repo. EAS builds take them from EAS environment variables instead.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  ios: {
    ...config.ios,
    config: {
      ...config.ios?.config,
      ...(process.env.GOOGLE_MAPS_IOS_KEY && { googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY }),
    },
  },
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      ...(process.env.GOOGLE_MAPS_ANDROID_KEY && {
        googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY },
      }),
    },
  },
});
