import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider } from '@/lib/store';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
