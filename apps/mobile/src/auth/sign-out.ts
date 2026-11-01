import { authApi } from '@/api';
import { useSession } from './session';

/** Ends the session on the server (revokes the token family), then forgets it locally. */
export async function signOut(): Promise<void> {
  try {
    await authApi.logout();
  } catch {
    // Offline or already revoked: forgetting the tokens locally is what matters here.
  }
  await useSession.getState().signOut();
}
