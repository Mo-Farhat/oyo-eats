import { Controller, Get, Inject, Module, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { ApiError } from '../common/api-error.js';
import { STORAGE } from '../tokens.js';
import { LocalDiskStorage, type FileStorage } from './storage.js';

/** Serves local-disk files to holders of a valid signed URL. Production uses R2's own URLs. */
@Controller('files')
export class FilesController {
  constructor(@Inject(STORAGE) private readonly storage: FileStorage) {}

  @Get(':key')
  @Public() // the signature is the access check
  async get(
    @Param('key') key: string,
    @Query('expires') expires: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    if (
      !(this.storage instanceof LocalDiskStorage) ||
      !this.storage.verify(key, Number(expires), String(sig))
    ) {
      throw new ApiError('not_found');
    }
    const file = await this.storage.get(key);
    if (!file) throw new ApiError('not_found');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.data);
  }
}

@Module({ controllers: [FilesController] })
export class StorageModule {}
