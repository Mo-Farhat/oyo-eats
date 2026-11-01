import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Tokens live in the iOS Keychain / Android Keystore (SEC-05), never in plain storage.
 * Web is only a development preview, so it falls back to localStorage there.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const native: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

const webPreview: SecretStore = {
  get: async (key) => globalThis.localStorage?.getItem(key) ?? null,
  set: async (key, value) => globalThis.localStorage?.setItem(key, value),
  remove: async (key) => globalThis.localStorage?.removeItem(key),
};

export const secretStore: SecretStore = Platform.OS === 'web' ? webPreview : native;
