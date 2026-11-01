import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post } from '@nestjs/common';
import {
  placeOrderSchema,
  quoteOrderSchema,
  type PlaceOrderInput,
  type QuoteOrderInput,
  rateOrderSchema,
  type RateOrderInput,
} from '@oyo/shared';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { Idempotent } from '../common/idempotency.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import type { JobQueue } from '../jobs/queue.js';
import type { Routing } from '../routing/routing.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import type { FileStorage } from '../storage/storage.js';
import { CONFIG, DB, JOBS, ROUTING, STORAGE } from '../tokens.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ReviewsService) private readonly reviews: ReviewsService,
  ) {}

  @Post(':id/ratings')
  @HttpCode(204)
  @RequirePermission('order.rate')
  async rate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(rateOrderSchema)) body: RateOrderInput,
  ) {
    await this.reviews.rate(auth, id, body);
  }

  @Post(':id/receipt')
  @HttpCode(200)
  @RequirePermission('order.view_own')
  receipt(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.orders.receipt(auth, id);
  }

  @Post('quote')
  @HttpCode(200)
  @RequirePermission('order.place')
  quote(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(quoteOrderSchema)) body: QuoteOrderInput,
  ) {
    return this.orders.quote(auth, body);
  }

  @Post()
  @RequirePermission('order.place')
  @Idempotent()
  place(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(placeOrderSchema)) body: PlaceOrderInput,
  ) {
    return this.orders.place(auth, body);
  }

  @Get()
  @RequirePermission('order.view_own')
  list(@CurrentAuth() auth: AuthContext) {
    return this.orders.list(auth);
  }

  @Get(':id')
  @RequirePermission('order.view_own')
  get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.orders.get(auth, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('order.cancel_own')
  cancel(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.orders.cancel(auth, id);
  }
}

@Module({
  controllers: [OrdersController],
  providers: [
    {
      provide: OrdersService,
      inject: [DB, ROUTING, JOBS, CONFIG, STORAGE],
      useFactory: (
        db: Db,
        routing: Routing,
        jobs: JobQueue,
        config: Config,
        storage: FileStorage,
      ) => new OrdersService(db, routing, jobs, config.encryptionKey, storage),
    },
    { provide: ReviewsService, inject: [DB], useFactory: (db: Db) => new ReviewsService(db) },
  ],
  exports: [OrdersService, ReviewsService],
})
export class OrdersModule {}
