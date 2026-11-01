import {
  OpenSans_400Regular,
  OpenSans_600SemiBold,
  OpenSans_700Bold,
} from '@expo-google-fonts/open-sans';
import {
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from '@expo-google-fonts/poppins';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { faceFor, useSession } from '@/auth/session';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 }, mutations: { retry: 0 } },
});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
    OpenSans_400Regular,
    OpenSans_600SemiBold,
    OpenSans_700Bold,
  });
  const status = useSession((s) => s.status);
  const session = useSession((s) => s.session);

  useEffect(() => {
    void useSession.getState().hydrate();
  }, []);

  const ready = fontsLoaded && status !== 'loading';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  const signedIn = status === 'signedIn' && session !== null;
  const needsSetup = signedIn && session.setup.length > 0;
  const face = signedIn && !needsSetup ? faceFor(session.account.role) : null;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }}
        >
          <Stack.Screen name="index" />
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={needsSetup}>
            <Stack.Screen name="(setup)" />
          </Stack.Protected>
          <Stack.Protected guard={face === 'customer'}>
            <Stack.Screen name="(customer)" />
          </Stack.Protected>
          <Stack.Protected guard={face === 'rider'}>
            <Stack.Screen name="(rider)" />
          </Stack.Protected>
          <Stack.Protected guard={face === 'restaurant'}>
            <Stack.Screen name="(restaurant)" />
          </Stack.Protected>
          <Stack.Protected guard={face === 'admin'}>
            <Stack.Screen name="(admin)" />
          </Stack.Protected>
        </Stack>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
