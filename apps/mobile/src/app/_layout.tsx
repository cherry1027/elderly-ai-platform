import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../language';

export default function RootLayout() {
  return <SafeAreaProvider>
    <LanguageProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
      </Stack>
    </LanguageProvider>
  </SafeAreaProvider>;
}
