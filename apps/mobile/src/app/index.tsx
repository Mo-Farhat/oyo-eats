import { Redirect } from 'expo-router';
import { faceFor, useSession } from '@/auth/session';

const HOME = {
  customer: '/home',
  rider: '/rider',
  restaurant: '/restaurant',
  admin: '/admin',
} as const;

/** Sends the user wherever their session says they belong. Screens navigate here after sign-in changes. */
export default function Index() {
  const session = useSession((s) => s.session);
  if (!session) return <Redirect href="/login" />;
  if (session.setup.includes('change_password')) return <Redirect href="/set-password" />;
  if (session.setup.includes('enroll_totp')) return <Redirect href="/enroll-2fa" />;
  return <Redirect href={HOME[faceFor(session.account.role)]} />;
}
