import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Root navigator. Every file in src/app/ becomes a screen; _layout.tsx files
 * define the navigators that wrap them.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Plan a trip' }} />
        <Stack.Screen name="route" options={{ title: 'Your journey' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
