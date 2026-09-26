import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * Root navigator. Every file in src/app/ becomes a screen; _layout.tsx files
 * define the navigators that wrap them.
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Plan a trip' }} />
      </Stack>
    </>
  );
}
