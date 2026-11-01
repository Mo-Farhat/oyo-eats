import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import type { Permission } from '@oyo/shared';
import type { Request } from 'express';
import type { AuthContext } from './auth.service.js';

/*
 * Every route must declare exactly one access rule, or the guard refuses it (deny by default):
 *   @Public()                 no sign-in
 *   @SignedIn()               any signed-in role
 *   @RequirePermission(...)   roles holding all of these permissions (roles.ts in @oyo/shared)
 *   @AllowLimited()           any signed-in role, including limited sessions (auth setup only)
 * Role checks are not object checks: services must still confirm the caller owns the record.
 */

export const IS_PUBLIC = 'access:public';
export const SIGNED_IN = 'access:signedIn';
export const PERMISSIONS = 'access:permissions';
export const ALLOW_LIMITED = 'access:allowLimited';
export const ACCESS_RULES = [IS_PUBLIC, SIGNED_IN, PERMISSIONS, ALLOW_LIMITED] as const;

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const SignedIn = () => SetMetadata(SIGNED_IN, true);
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(PERMISSIONS, permissions);
export const AllowLimited = () => applyDecorators(SetMetadata(ALLOW_LIMITED, true), SignedIn());

export type AuthedRequest = Request & { auth?: AuthContext };

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
    if (!auth) throw new Error('CurrentAuth used on a public route');
    return auth;
  },
);
