import { Inject } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, type OnGatewayConnection } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service.js';
import { roomsForAccount, route, type LiveNotice } from './rooms.js';

/**
 * Socket.IO at /live. A socket signs in with its access token in the handshake and joins its
 * rooms; it only ever receives "this changed" messages and refetches over HTTP, where every
 * permission check still applies.
 */
@WebSocketGateway({ namespace: '/live' })
export class LiveGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Namespace;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async handleConnection(socket: Socket) {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    try {
      if (typeof token !== 'string') throw new Error('no token');
      const ctx = await this.auth.authenticate(token);
      if (ctx.limited) throw new Error('setup pending');
      await socket.join(roomsForAccount(ctx));
      socket.emit('ready');
    } catch {
      // Expired or revoked: the app refreshes its token and reconnects.
      socket.emit('unauthorized');
      socket.disconnect(true);
    }
  }

  publish(notice: LiveNotice) {
    const { rooms, message } = route(notice);
    this.server?.to(rooms).emit('changed', message);
  }

  /** Sockets connected now, for logs and tests. */
  get connections() {
    return this.server?.sockets.size ?? 0;
  }
}
