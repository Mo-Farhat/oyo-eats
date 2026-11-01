import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post } from '@nestjs/common';
import {
  acceptOrderSchema,
  delayOrderSchema,
  rejectOrderSchema,
  storeStatusSchema,
  type AcceptOrderInput,
  type DelayOrderInput,
  type RejectOrderInput,
} from '@oyo/shared';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Db } from '../db/client.js';
import { DB } from '../tokens.js';
import { RestaurantOrdersService } from './restaurant-orders.service.js';

@Controller('restaurant')
export class RestaurantController {
  constructor(@Inject(RestaurantOrdersService) private readonly service: RestaurantOrdersService) {}

  @Get('board')
  @RequirePermission('restaurant.orders.view')
  board(@CurrentAuth() auth: AuthContext) {
    return this.service.board(auth);
  }

  @Post('orders/:id/accept')
  @HttpCode(204)
  @RequirePermission('restaurant.orders.respond')
  async accept(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(acceptOrderSchema)) body: AcceptOrderInput,
  ) {
    await this.service.accept(auth, id, body);
  }

  @Post('orders/:id/reject')
  @HttpCode(204)
  @RequirePermission('restaurant.orders.respond')
  async reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(rejectOrderSchema)) body: RejectOrderInput,
  ) {
    await this.service.reject(auth, id, body);
  }

  @Post('orders/:id/ready')
  @HttpCode(204)
  @RequirePermission('restaurant.orders.update')
  async ready(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.service.ready(auth, id);
  }

  @Post('orders/:id/delay')
  @HttpCode(204)
  @RequirePermission('restaurant.orders.update')
  async delay(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(delayOrderSchema)) body: DelayOrderInput,
  ) {
    await this.service.delay(auth, id, body);
  }

  @Post('status')
  @HttpCode(204)
  @RequirePermission('restaurant.hours.edit')
  async status(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(storeStatusSchema)) body: z.infer<typeof storeStatusSchema>,
  ) {
    await this.service.setOpen(auth, body.open);
  }
}

@Module({
  controllers: [RestaurantController],
  providers: [
    {
      provide: RestaurantOrdersService,
      inject: [DB],
      useFactory: (db: Db) => new RestaurantOrdersService(db),
    },
  ],
})
export class RestaurantModule {}
