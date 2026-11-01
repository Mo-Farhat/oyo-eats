import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post } from '@nestjs/common';
import {
  declineOfferSchema,
  deliverSchema,
  offerSchema,
  riderLocationSchema,
  riderStatusSchema,
  type DeliverInput,
  type RiderLocationInput,
} from '@oyo/shared';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { JobQueue } from '../jobs/queue.js';
import { CONFIG, DB, JOBS } from '../tokens.js';
import { DispatchService } from './dispatch.service.js';
import { RiderService } from './rider.service.js';

@Controller('admin')
export class DispatchController {
  constructor(@Inject(DispatchService) private readonly dispatch: DispatchService) {}

  @Get('board')
  @RequirePermission('orders.view_all')
  board() {
    return this.dispatch.board();
  }

  @Get('orders/:id/candidates')
  @RequirePermission('orders.assign')
  candidates(@Param('id', UuidPipe) id: string) {
    return this.dispatch.candidates(id);
  }

  @Post('orders/:id/lock')
  @HttpCode(200)
  @RequirePermission('orders.assign')
  lock(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.dispatch.lock(auth, id);
  }

  @Post('orders/:id/offer')
  @RequirePermission('orders.assign')
  offer(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(offerSchema)) body: z.infer<typeof offerSchema>,
  ) {
    return this.dispatch.offer(auth, id, body.riderId);
  }

  @Post('offers/:id/cancel')
  @HttpCode(204)
  @RequirePermission('orders.assign')
  async cancel(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.dispatch.cancelOffer(auth, id);
  }
}

@Controller('rider')
export class RiderController {
  constructor(@Inject(RiderService) private readonly rider: RiderService) {}

  @Get('state')
  @RequirePermission('job.view_own')
  state(@CurrentAuth() auth: AuthContext) {
    return this.rider.state(auth);
  }

  @Post('status')
  @HttpCode(204)
  @RequirePermission('rider.go_online')
  async status(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(riderStatusSchema)) body: z.infer<typeof riderStatusSchema>,
  ) {
    await this.rider.setOnline(auth, body.online);
  }

  @Post('location')
  @HttpCode(204)
  @RequirePermission('rider.go_online')
  async location(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(riderLocationSchema)) body: RiderLocationInput,
  ) {
    await this.rider.location(auth, body);
  }

  @Post('offers/:id/accept')
  @HttpCode(204)
  @RequirePermission('job.respond_offer')
  async accept(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.rider.accept(auth, id);
  }

  @Post('offers/:id/decline')
  @HttpCode(204)
  @RequirePermission('job.respond_offer')
  async decline(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(declineOfferSchema)) body: z.infer<typeof declineOfferSchema>,
  ) {
    await this.rider.decline(auth, id, body.reason);
  }

  @Post('orders/:id/pickup')
  @HttpCode(204)
  @RequirePermission('job.update_status')
  async pickup(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.rider.pickup(auth, id);
  }

  @Post('orders/:id/deliver')
  @HttpCode(204)
  @RequirePermission('job.update_status')
  async deliver(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(deliverSchema)) body: DeliverInput,
  ) {
    await this.rider.deliver(auth, id, body);
  }
}

@Module({
  controllers: [DispatchController, RiderController],
  providers: [
    {
      provide: DispatchService,
      inject: [DB, JOBS],
      useFactory: (db: Db, jobs: JobQueue) => new DispatchService(db, jobs),
    },
    {
      provide: RiderService,
      inject: [DB, JOBS, CONFIG],
      useFactory: (db: Db, jobs: JobQueue, config: Config) =>
        new RiderService(db, jobs, config.encryptionKey),
    },
  ],
})
export class DispatchModule {}
