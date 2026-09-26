import type { ExpoConfig } from 'expo/config';

/**
 * Config lives here rather than app.json so secrets can come from the
 * environment instead of being committed. See .env.example.
 *
 * EXPO_PUBLIC_* values are inlined into the JS bundle at build time, which is
 * expected for a client-side key — restrict the Google Maps key by Android
 * package name + SHA-1 fingerprint in Google Cloud Console.
 */
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

const mapsPluginOptions: Record<string, string> = {};
if (googleMapsApiKey) {
  mapsPluginOptions.androidGoogleMapsApiKey = googleMapsApiKey;
  mapsPluginOptions.iosGoogleMapsApiKey = googleMapsApiKey;
}

const config: ExpoConfig = {
  name: 'TransitGuide',
  slug: 'transit-guide',
  /** Deep-link scheme. Required by Expo Router. */
  scheme: 'transitguide',
  version: '0.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.hackathon26.transitguide',
  },
  android: {
    package: 'com.hackathon26.transitguide',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    /**
     * Required by Expo Router. Expo CLI prints this plugin entry after
     * installing expo-router; the manual-install docs omit it.
     */
    'expo-router',
    /**
     * Only injects the Google Maps key when EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is
     * set. Without it, iOS still renders Apple Maps; Android renders a blank
     * grid until the key is configured.
     */
    ['react-native-maps', mapsPluginOptions],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
