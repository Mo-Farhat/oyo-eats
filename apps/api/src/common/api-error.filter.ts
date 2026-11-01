import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from './api-error.js';

/** Sends API failures as `{ error: code, ...details }` with the code's HTTP status. */
@Catch(ApiError)
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: ApiError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (typeof error.details.retryAfterSeconds === 'number') {
      response.setHeader('Retry-After', String(error.details.retryAfterSeconds));
    }
    response.status(error.status).json({ error: error.code, ...error.details });
  }
}
