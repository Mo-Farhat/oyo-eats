import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { SmsSender } from '../sms/sms.js';
import { CONFIG, DB, SMS } from '../tokens.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PwnedPasswordsChecker } from './passwords.js';

@Module({
  // Single API instance, so the in-memory throttler store is enough (see DECISIONS.md).
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
  controllers: [AuthController],
  providers: [
    {
      provide: AuthService,
      inject: [DB, CONFIG, SMS],
      useFactory: (db: Db, config: Config, sms: SmsSender) =>
        new AuthService(
          db,
          { hashKey: config.hashKey, encryptionKey: config.encryptionKey },
          sms,
          new PwnedPasswordsChecker(),
        ),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
