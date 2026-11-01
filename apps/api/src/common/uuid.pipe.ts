import { type PipeTransform } from '@nestjs/common';
import { ApiError } from './api-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids must be UUIDs; anything else is simply not found. */
export class UuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new ApiError('not_found');
    return value;
  }
}
