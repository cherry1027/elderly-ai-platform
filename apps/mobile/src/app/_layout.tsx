import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LanguageProvider } from '../language';
import { GenerationActionsProvider } from '../generation/GenerationActions';
import { AuthProvider } from '../auth/AuthProvider';
import { LoginNavigationProvider } from '../navigation/LoginNavigation';
import { RegistrationProvider } from '../auth/RegistrationProvider';
import { readStoryPreviewEnabled } from '../development/story-preview-config';
import { StoryPreview } from '../development/StoryPreview';
import { PdfPrivacyProvider } from '../exports/PdfPrivacy';

export default function RootLayout() {
  // The explicit sample launcher never mounts account or preference providers.
  if (readStoryPreviewEnabled()) return <SafeAreaProvider><StatusBar style="dark" /><StoryPreview /></SafeAreaProvider>;
  return <SafeAreaProvider>
    <LanguageProvider>
      <AuthProvider>
        <PdfPrivacyProvider>
        <GenerationActionsProvider>
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
        </GenerationActionsProvider>
      </PdfPrivacyProvider>
      </AuthProvider>
    </LanguageProvider>
  </SafeAreaProvider>;
}
