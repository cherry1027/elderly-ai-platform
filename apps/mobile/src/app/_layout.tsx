import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../language';
import { AuthProvider } from '../auth/AuthProvider';
import { LoginNavigationProvider } from '../navigation/LoginNavigation';
import { RegistrationProvider } from '../auth/RegistrationProvider';

export default function RootLayout() {
  return <SafeAreaProvider>
    <LanguageProvider>
      <AuthProvider>
        <RegistrationProvider>
          <LoginNavigationProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="language" />
              <Stack.Screen name="introduction" />
              <Stack.Screen name="welcome" />
              <Stack.Screen name="login" />
              <Stack.Screen name="register" />
              <Stack.Screen name="auth/confirm" />
              <Stack.Screen name="authenticated" />
            </Stack>
          </LoginNavigationProvider>
        </RegistrationProvider>
      </AuthProvider>
    </LanguageProvider>
  </SafeAreaProvider>;
}
