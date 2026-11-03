import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  emergencyContactSchema,
  cancelRequestSchema,
  problemReportSchema,
  refundPaidSchema,
  refundSchema,
  resolveCaseSchema,
  riderIssueSchema,
  type CancelRequestInput,
  type ProblemReportInput,
  type RefundInput,
  type RiderIssueInput,
} from '@oyo/shared';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { Idempotent } from '../common/idempotency.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { FileStorage } from '../storage/storage.js';
import { CONFIG, DB, SMS, STORAGE } from '../tokens.js';
import type { SmsSender } from '../sms/sms.js';
import { RiderProfileService } from './rider-profile.js';
import { PHOTO_MAX_BYTES, SupportService, type UploadedPhoto } from './support.service.js';

/** C14 and C19: the customer's side. */
@Controller('orders')
export class CustomerSupportController {
  constructor(@Inject(SupportService) private readonly service: SupportService) {}

  @Post(':id/cancel-request')
  @RequirePermission('order.cancel_own')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(cancelRequestSchema)) body: CancelRequestInput,
  ) {
    return this.service.requestCancel(auth, id, body);
  }

  @Post(':id/problems')
  @UseInterceptors(
    FilesInterceptor('photos', 3, { limits: { fileSize: PHOTO_MAX_BYTES, files: 3, fields: 4 } }),
  )
  @RequirePermission('order.report_problem')
  report(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(problemReportSchema)) body: ProblemReportInput,
    @UploadedFiles() files: UploadedPhoto[] | undefined,
  ) {
    return this.service.reportProblem(auth, id, body, files ?? []);
  }

  @Get(':id/cases')
  @RequirePermission('order.view_own')
  cases(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.myCases(auth, id);
  }
}

/** R12, the emergency button, and R13 the rider's profile. */
@Controller('rider')
export class RiderSupportController {
  constructor(
    @Inject(SupportService) private readonly service: SupportService,
    @Inject(RiderProfileService) private readonly profile: RiderProfileService,
  ) {}

  @Get('profile')
  @RequirePermission('job.view_own')
  getProfile(@CurrentAuth() auth: AuthContext) {
    return this.profile.get(auth);
  }

  @Post('profile/emergency-contact')
  @RequirePermission('rider.emergency')
  setContact(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(emergencyContactSchema)) body: z.infer<typeof emergencyContactSchema>,
  ) {
    return this.profile.setEmergencyContact(auth, body);
  }

  @Post('orders/:id/issue')
  @RequirePermission('job.report_issue')
  issue(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(riderIssueSchema)) body: RiderIssueInput,
  ) {
    return this.service.riderIssue(auth, id, body);
  }

  @Post('emergency')
  @RequirePermission('rider.emergency')
  emergency(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(riderIssueSchema)) body: RiderIssueInput,
  ) {
    return this.service.riderIssue(auth, null, { ...body, type: 'emergency' });
  }
}

/** A22: the office's support queue and refunds (ADM-16). */
@Controller('admin')
export class AdminSupportController {
  constructor(@Inject(SupportService) private readonly service: SupportService) {}

  @Get('cases')
  @RequirePermission('support.manage')
  list(@Query('status') status?: string) {
    return this.service.list(status === 'resolved' ? 'resolved' : 'open');
  }

  @Get('cases/:id')
  @RequirePermission('support.manage')
  get(@Param('id', UuidPipe) id: string) {
    return this.service.get(id);
  }

  @Post('cases/:id/refund')
  @Idempotent()
  @RequirePermission('refunds.issue_within_cap')
  refundCase(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(refundSchema)) body: RefundInput,
  ) {
    return this.service.refund(auth, { caseId: id }, body);
  }

  @Post('orders/:id/refund')
  @Idempotent()
  @RequirePermission('refunds.issue_within_cap')
  refundOrder(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(refundSchema)) body: RefundInput,
  ) {
    return this.service.refund(auth, { orderId: id }, body);
  }

  @Post('cases/:id/resolve')
  @RequirePermission('support.manage')
  resolve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(resolveCaseSchema)) body: z.infer<typeof resolveCaseSchema>,
  ) {
    return this.service.resolve(auth, id, body.resolution);
  }

  @Post('refunds/:id/paid')
  @Idempotent()
  @RequirePermission('refunds.issue_any')
  paid(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(refundPaidSchema)) body: z.infer<typeof refundPaidSchema>,
  ) {
    return this.service.markRefundPaid(auth, id, body.reference);
  }
}

@Module({
  controllers: [CustomerSupportController, RiderSupportController, AdminSupportController],
  providers: [
    {
      provide: SupportService,
      inject: [DB, STORAGE, CONFIG, SMS],
      useFactory: (db: Db, storage: FileStorage, config: Config, sms: SmsSender) =>
        new SupportService(db, storage, config.encryptionKey, sms),
    },
    {
      provide: RiderProfileService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: Config) => new RiderProfileService(db, config.encryptionKey),
    },
  ],
})
export class SupportModule {}
