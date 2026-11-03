import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Post,
  type DynamicModule,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { pushTokenSchema, type PushTokenInput } from '@oyo/shared';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, SignedIn } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { LiveBus } from '../live/live.bus.js';
import { CONFIG, DB, SMS } from '../tokens.js';
import type { SmsSender } from '../sms/sms.js';
import { NotificationsService } from './notifications.service.js';
import { ConsolePushSender, ExpoPushSender, type PushSender } from './push.js';

export const PUSH = Symbol('PUSH');

/** NOT-06 in-app list and push token registration. */
@Controller('me')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly service: NotificationsService) {}

  @Get('notifications')
  @SignedIn()
  list(@CurrentAuth() auth: AuthContext) {
    return this.service.list(auth);
  }

  @Post('notifications/read')
  @HttpCode(204)
  @SignedIn()
  async read(@CurrentAuth() auth: AuthContext) {
    await this.service.markAllRead(auth);
  }

  @Post('push-token')
  @HttpCode(204)
  @SignedIn()
  async register(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(pushTokenSchema)) body: PushTokenInput,
  ) {
    await this.service.registerToken(auth, body.token, body.platform);
  }

  @Delete('push-token')
  @HttpCode(204)
  @SignedIn()
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(pushTokenSchema)) body: PushTokenInput,
  ) {
    await this.service.removeToken(auth, body.token);
  }
}

/** Runs the sender on every committed change (debounced) and every 15 s as a sweep. */
class NotificationsWorker implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private debounce?: NodeJS.Timeout;
  private off?: () => void;

  constructor(
    @Inject(NotificationsService) private readonly service: NotificationsService,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  onModuleInit() {
    this.off = this.bus.on((n) => {
      if (n.kind !== 'order') return;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.service.runOnce(), 300);
    });
    this.timer = setInterval(() => void this.service.runOnce(), 15_000);
  }

  onModuleDestroy() {
    this.off?.();
    clearInterval(this.timer);
    clearTimeout(this.debounce);
  }
}

@Module({})
export class NotificationsModule {
  /** The worker is off in tests; they call runOnce() themselves. */
  static forRoot(work: boolean, sender?: PushSender): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [NotificationsController],
      providers: [
        {
          provide: PUSH,
          inject: [CONFIG],
          useFactory: (config: Config) =>
            sender ??
            (config.expoPush
              ? new ExpoPushSender(config.expoPush.accessToken)
              : new ConsolePushSender()),
        },
        {
          provide: NotificationsService,
          inject: [DB, PUSH, SMS, CONFIG],
          useFactory: (db: Db, push: PushSender, sms: SmsSender, config: Config) =>
            new NotificationsService(db, push, { sms, encryptionKey: config.encryptionKey }),
        },
        ...(work ? [NotificationsWorker] : []),
      ],
      exports: [NotificationsService],
    };
  }
}
