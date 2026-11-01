import type { Role, SetupStep, SignInResponse, TokensResponse } from '@oyo/shared';
import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { secretStore } from './secret-store';

const SESSION_KEY = 'oyo.session';
const DEVICE_KEY = 'oyo.deviceId';

export interface StoredSession {
  tokens: TokensResponse;
  account: SignInResponse['account'];
  setup: SetupStep[];
}

interface SessionState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: StoredSession | null;
  /** Stable per install; the API binds rider and restaurant accounts to it (SEC-06). */
  deviceId: string;
  /**
   * The temporary password typed at sign-in, kept in memory only, so S05 doesn't ask for it
   * again. Cleared once the password is changed or the app restarts.
   */
  temporaryPassword: string | null;
  hydrate(): Promise<void>;
  signIn(result: SignInResponse, temporaryPassword?: string): Promise<void>;
  setTokens(tokens: TokensResponse): Promise<void>;
  signOut(): Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  session: null,
  deviceId: '',
  temporaryPassword: null,

  async hydrate() {
    let deviceId = await secretStore.get(DEVICE_KEY);
    if (!deviceId) {
      deviceId = Crypto.randomUUID();
      await secretStore.set(DEVICE_KEY, deviceId);
    }
    const raw = await secretStore.get(SESSION_KEY);
    const session = raw ? (JSON.parse(raw) as StoredSession) : null;
    set({ deviceId, session, status: session ? 'signedIn' : 'signedOut' });
  },

  async signIn(result, temporaryPassword) {
    const session: StoredSession = {
      tokens: result.tokens,
      account: result.account,
      setup: result.setup,
    };
    await secretStore.set(SESSION_KEY, JSON.stringify(session));
    set({
      session,
      status: 'signedIn',
      temporaryPassword: result.setup.includes('change_password')
        ? (temporaryPassword ?? get().temporaryPassword)
        : null,
    });
  },

  async setTokens(tokens) {
    const current = get().session;
    if (!current) return;
    const session = { ...current, tokens };
    await secretStore.set(SESSION_KEY, JSON.stringify(session));
    set({ session });
  },

  async signOut() {
    await secretStore.remove(SESSION_KEY);
    set({ session: null, status: 'signedOut', temporaryPassword: null });
  },
}));

export type Face = 'customer' | 'rider' | 'restaurant' | 'admin';

/** Which app face a role opens (PRD section 2). */
export function faceFor(role: Role): Face {
  switch (role) {
    case 'customer':
      return 'customer';
    case 'rider':
      return 'rider';
    case 'restaurant_staff':
    case 'restaurant_owner':
      return 'restaurant';
    case 'dispatcher':
    case 'owner':
      return 'admin';
  }
}
