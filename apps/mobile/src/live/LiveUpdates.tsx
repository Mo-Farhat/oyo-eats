import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { authApi, baseUrl } from '@/api';
import { useSession } from '@/auth/session';

type LiveMessage = { kind: 'order'; orderId: string; type: string } | { kind: 'menu' };

/**
 * Screens to refetch for a message. Keys not in this device's cache are skipped by TanStack
 * Query, so one list serves every face.
 */
function keysFor(m: LiveMessage): QueryKey[] {
  if (m.kind === 'menu') {
    return [['restaurant-menu'], ['restaurant-menu-requests'], ['menu-approvals']];
  }
  const keys: QueryKey[] = [
    ['order', m.orderId],
    ['orders'],
    ['restaurant-board'],
    ['rider-state'],
    ['dispatch-board'],
    ['admin-order', m.orderId],
    ['candidates', m.orderId],
    ['admin-riders'],
    ['notifications'],
    ['rider-earnings'],
    ['restaurant-payouts'],
  ];
  if (m.type.startsWith('slip_') || m.type === 'placed') keys.push(['slips']);
  return keys;
}

function refetch(client: QueryClient, m: LiveMessage) {
  for (const queryKey of keysFor(m)) void client.invalidateQueries({ queryKey });
}

/**
 * Live updates (Socket.IO): signs in with the current access token, and on "changed" refetches
 * the affected screens. Polling stays on as a fallback at its own pace. Renders nothing.
 */
export function LiveUpdates() {
  const client = useQueryClient();
  useEffect(() => {
    const socket = io(`${baseUrl}/live`, {
      transports: ['websocket'],
      // Read on every (re)connect, so a refreshed token is picked up.
      auth: (cb) => cb({ token: useSession.getState().session?.tokens.accessToken }),
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
    });
    socket.on('changed', (m: LiveMessage) => refetch(client, m));
    // After a gap (not the first connection), catch up on anything missed.
    let connectedBefore = false;
    socket.on('ready', () => {
      if (connectedBefore) void client.invalidateQueries();
      connectedBefore = true;
    });
    socket.on('unauthorized', () => {
      // An expired access token: any authenticated call refreshes it, then reconnect.
      void authApi
        .me()
        .then(() => socket.connect())
        .catch(() => undefined);
    });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !socket.connected) socket.connect();
    });
    return () => {
      sub.remove();
      socket.close();
    };
  }, [client]);
  return null;
}
