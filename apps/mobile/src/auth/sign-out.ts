import { authApi } from '@/api';
import { currentPushToken } from '@/push/PushSetup';
import { useSession } from './session';

/** Ends the session on the server (revokes the token family), then forgets it locally. */
export async function signOut(): Promise<void> {
  // This phone stops getting this person's pushes.
  const token = currentPushToken();
  if (token) await authApi.removePush(token).catch(() => undefined);
  try {
    await authApi.logout();
  } catch {
    // Offline or already revoked: forgetting the tokens locally is what matters here.
  }
  await useSession.getState().signOut();
}
