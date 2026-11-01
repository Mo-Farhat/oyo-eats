import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard.js';
import {
  changePasswordSchema,
  confirmTotpSchema,
  refreshSchema,
  requestOtpSchema,
  staffLoginSchema,
  verifyOtpSchema,
  type ChangePasswordInput,
  type ConfirmTotpInput,
  type RefreshInput,
  type RequestOtpInput,
  type StaffLoginInput,
  type VerifyOtpInput,
} from '@oyo/shared';
import type { Request } from 'express';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuthService, type AuthContext, type RequestMeta } from './auth.service.js';
import { AllowLimited, CurrentAuth, Public } from './decorators.js';

function meta(request: Request, deviceId?: string): RequestMeta {
  const header = request.headers['x-device-id'];
  return {
    ip: request.ip,
    deviceId: deviceId ?? (typeof header === 'string' ? header : undefined),
  };
}

@Controller('auth')
@UseGuards(RateLimitGuard) // per-IP limit on every auth route (SEC-01, SEC-26)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('otp/request')
  @HttpCode(202)
  requestOtp(@Body(new ZodPipe(requestOtpSchema)) body: RequestOtpInput, @Req() req: Request) {
    return this.auth.requestOtp(body.phone, meta(req));
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body(new ZodPipe(verifyOtpSchema)) body: VerifyOtpInput, @Req() req: Request) {
    return this.auth.verifyOtp(body, meta(req, body.deviceId));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodPipe(staffLoginSchema)) body: StaffLoginInput, @Req() req: Request) {
    return this.auth.login(body, meta(req, body.deviceId));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshSchema)) body: RefreshInput, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @AllowLimited()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext) {
    await this.auth.logout(auth);
  }

  @AllowLimited()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return {
      accountId: auth.accountId,
      role: auth.role,
      tenantId: auth.tenantId,
      limited: auth.limited,
    };
  }

  @AllowLimited()
  @Post('password')
  @HttpCode(200)
  changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(auth, body, meta(req));
  }

  @AllowLimited()
  @Post('totp/setup')
  @HttpCode(200)
  startTotp(@CurrentAuth() auth: AuthContext) {
    return this.auth.startTotpEnrollment(auth);
  }

  @AllowLimited()
  @Post('totp/confirm')
  @HttpCode(200)
  confirmTotp(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(confirmTotpSchema)) body: ConfirmTotpInput,
    @Req() req: Request,
  ) {
    return this.auth.confirmTotpEnrollment(auth, body.code, meta(req));
  }
}
