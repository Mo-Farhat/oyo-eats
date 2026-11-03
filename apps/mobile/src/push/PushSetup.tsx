import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { authApi } from '@/api';
import type { Face } from '@/auth/session';

/** Show pushes while the app is open too (the in-app screens update live anyway). Not on web. */
if (Platform.OS !== 'web')
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

/** The token this phone registered, so sign-out can remove it. */
let registered: string | null = null;
export const currentPushToken = () => registered;

/**
 * Registers this phone for push once signed in (section 10). Needs a real device and the EAS
 * project id (`eas init`); until then it quietly does nothing and the in-app list still works.
 */
async function register(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return;
  if (Platform.OS === 'android') {
    // Offers, new orders and "rider assigned" ring through Do Not Disturb-light settings.
    await Notifications.setNotificationChannelAsync('critical', {
      name: 'Orders and job offers',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 400, 200, 400],
    });
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Order updates',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await authApi.registerPush(token, Platform.OS === 'ios' ? 'ios' : 'android');
  registered = token;
}

/** Where a tapped notification should land, by face. */
function target(face: Face, data: { orderId?: string }): Href | null {
  const id = data.orderId;
  switch (face) {
    case 'customer':
      return id ? `/order/${id}` : '/orders';
    case 'rider':
      return '/rider';
    case 'restaurant':
      return id ? `/kitchen/${id}` : '/restaurant';
    case 'admin':
      return id ? `/ticket/${id}` : '/admin';
  }
}

/** Mounted once signed in: registers for push and opens the right screen when one is tapped. */
export function PushSetup({ face }: { face: Face }) {
  // Push is phones only; the web preview has no notification APIs.
  return Platform.OS === 'web' ? null : <PhonePush face={face} />;
}

function PhonePush({ face }: { face: Face }) {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    register().catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!last) return;
    const href = target(face, last.notification.request.content.data as { orderId?: string });
    if (href) router.push(href);
  }, [last, face]);
  return null;
}
