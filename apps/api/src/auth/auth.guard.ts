import {
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, type Permission } from '@oyo/shared';
import { ApiError } from '../common/api-error.js';
import { AuthService } from './auth.service.js';
import {
  ALLOW_LIMITED,
  IS_PUBLIC,
  PERMISSIONS,
  SIGNED_IN,
  type AuthedRequest,
} from './decorators.js';

/** Global guard: authenticates the bearer token, then applies the route's access rule. */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const read = <T>(key: string) => this.reflector.getAllAndOverride<T | undefined>(key, targets);
    if (read<boolean>(IS_PUBLIC)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new ApiError('invalid_token');
    const auth = await this.auth.authenticate(token);
    request.auth = auth;

    if (auth.limited && !read<boolean>(ALLOW_LIMITED)) throw new ApiError('setup_required');

    const permissions = read<Permission[]>(PERMISSIONS);
    if (permissions) {
      if (!permissions.every((p) => can(auth.role, p))) throw new ApiError('forbidden');
      return true;
    }
    if (read<boolean>(SIGNED_IN)) return true;

    this.logger.error(`${request.method} ${request.path} declares no access rule; refusing`);
    throw new ApiError('forbidden');
  }
}
