import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../language';
import { AuthProvider } from '../auth/AuthProvider';
import { LoginNavigationProvider } from '../navigation/LoginNavigation';

export default function RootLayout() {
  return <SafeAreaProvider>
    <LanguageProvider>
      <AuthProvider>
        <LoginNavigationProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="language" />
            <Stack.Screen name="introduction" />
            <Stack.Screen name="welcome" />
            <Stack.Screen name="login" />
            <Stack.Screen name="authenticated" />
          </Stack>
        </LoginNavigationProvider>
      </AuthProvider>
    </LanguageProvider>
  </SafeAreaProvider>;
}
