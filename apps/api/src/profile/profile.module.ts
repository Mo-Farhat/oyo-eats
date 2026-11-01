import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  phoneChangeRequestSchema,
  phoneChangeVerifySchema,
  profileUpdateSchema,
  type PhoneChangeVerifyInput,
  type ProfileUpdateInput,
} from '@oyo/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuthModule } from '../auth/auth.module.js';
import { AuthService, type AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { RateLimitGuard } from '../auth/rate-limit.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { CONFIG, DB } from '../tokens.js';
import { ProfileService } from './profile.service.js';
import { ThrottlerModule } from '@nestjs/throttler';

@Controller('me')
export class ProfileController {
  constructor(
    @Inject(ProfileService) private readonly profile: ProfileService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get('profile')
  @RequirePermission('profile.manage_own')
  get(@CurrentAuth() auth: AuthContext) {
    return this.profile.get(auth);
  }

  @Patch('profile')
  @RequirePermission('profile.manage_own')
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(profileUpdateSchema)) body: ProfileUpdateInput,
  ) {
    return this.profile.update(auth, body);
  }

  /** Step 1 of a verified phone change: a code goes to the new number. */
  @Post('phone/request')
  @HttpCode(202)
  @UseGuards(RateLimitGuard)
  @RequirePermission('profile.manage_own')
  requestPhone(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(phoneChangeRequestSchema)) body: z.infer<typeof phoneChangeRequestSchema>,
    @Req() req: Request,
  ) {
    return this.auth.requestPhoneChange(auth, body.phone, {
      ip: req.ip,
      deviceId: auth.deviceId ?? undefined,
    });
  }

  @Post('phone/verify')
  @HttpCode(204)
  @UseGuards(RateLimitGuard)
  @RequirePermission('profile.manage_own')
  async verifyPhone(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(phoneChangeVerifySchema)) body: PhoneChangeVerifyInput,
    @Req() req: Request,
  ) {
    await this.auth.confirmPhoneChange(auth, body, {
      ip: req.ip,
      deviceId: auth.deviceId ?? undefined,
    });
  }

  /** Delete account (CUS-18, PRI-06). */
  @Delete()
  @HttpCode(204)
  @RequirePermission('profile.manage_own')
  async remove(@CurrentAuth() auth: AuthContext) {
    await this.profile.delete(auth);
  }
}

@Module({
  imports: [AuthModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
  controllers: [ProfileController],
  providers: [
    {
      provide: ProfileService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: Config) => new ProfileService(db, config.encryptionKey),
    },
  ],
})
export class ProfileModule {}
