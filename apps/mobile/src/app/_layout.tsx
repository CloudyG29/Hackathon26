import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

/**
 * Root navigator. Every file in src/app/ becomes a screen; _layout.tsx files
 * define the navigators that wrap them.
 *
 * The native stack header is hidden app-wide: each screen renders the shared
 * <ScreenHeader> instead, so titles and the back button look identical across
 * pages (see components/ScreenHeader.tsx).
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="route" />
      </Stack>
    </SafeAreaProvider>
  );
}
