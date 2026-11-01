import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  slipRejectSchema,
  slipUploadSchema,
  type SlipRejectInput,
  type SlipUploadInput,
} from '@oyo/shared';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Db } from '../db/client.js';
import type { JobQueue } from '../jobs/queue.js';
import type { FileStorage } from '../storage/storage.js';
import { DB, JOBS, STORAGE } from '../tokens.js';
import { SLIP_MAX_BYTES, SlipsService, type UploadedFile as Upload } from './slips.service.js';

@Controller()
export class SlipsController {
  constructor(@Inject(SlipsService) private readonly slips: SlipsService) {}

  /** C08: the customer uploads a transfer slip (multipart field "slip"). */
  @Post('orders/:id/slip')
  @HttpCode(204)
  @RequirePermission('order.place')
  @UseInterceptors(
    FileInterceptor('slip', { limits: { fileSize: SLIP_MAX_BYTES, files: 1, fields: 4 } }),
  )
  async upload(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @UploadedFile() file: Upload | undefined,
    @Body(new ZodPipe(slipUploadSchema)) body: SlipUploadInput,
  ) {
    await this.slips.upload(auth, id, file, body);
  }

  /** A12: slips waiting for review. */
  @Get('admin/slips')
  @RequirePermission('bank_slips.review')
  queue() {
    return this.slips.queue();
  }

  @Post('admin/slips/:id/approve')
  @HttpCode(204)
  @RequirePermission('bank_slips.review')
  async approve(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.slips.approve(auth, id);
  }

  @Post('admin/slips/:id/reject')
  @HttpCode(204)
  @RequirePermission('bank_slips.review')
  async reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(slipRejectSchema)) body: SlipRejectInput,
  ) {
    await this.slips.reject(auth, id, body);
  }
}

@Module({
  controllers: [SlipsController],
  providers: [
    {
      provide: SlipsService,
      inject: [DB, STORAGE, JOBS],
      useFactory: (db: Db, storage: FileStorage, jobs: JobQueue) =>
        new SlipsService(db, storage, jobs),
    },
  ],
})
export class PaymentsModule {}
