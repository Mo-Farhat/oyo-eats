import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';
import { ApiError } from '../common/api-error.js';

/** Per-IP throttling that fails with the same `{ error }` shape as the rest of the API. */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    _: unknown,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ApiError('rate_limited', {
      retryAfterSeconds: Math.max(1, detail.timeToBlockExpire),
    });
  }
}
