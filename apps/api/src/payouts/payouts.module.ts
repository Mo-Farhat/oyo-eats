import { Controller, Get, Header, Inject, Module, Param } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { SettlementsService } from '../admin/settlements.service.js';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import type { Db } from '../db/client.js';
import { DB } from '../tokens.js';
import { PayoutsService } from './payouts.service.js';

/** T11: the restaurant owner's statements (RES-11). */
@Controller('restaurant/payouts')
export class RestaurantPayoutsController {
  constructor(@Inject(PayoutsService) private readonly service: PayoutsService) {}

  @Get()
  @RequirePermission('restaurant.payouts.view')
  list(@CurrentAuth() auth: AuthContext) {
    return this.service.restaurant(auth);
  }

  @Get(':id')
  @RequirePermission('restaurant.payouts.view')
  get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.statement(auth, id);
  }

  @Get(':id/csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @RequirePermission('restaurant.payouts.view')
  csv(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.csv(auth, id);
  }
}

/** R10: the rider's earnings and payouts. */
@Controller('rider/earnings')
export class RiderEarningsController {
  constructor(@Inject(PayoutsService) private readonly service: PayoutsService) {}

  @Get()
  @RequirePermission('earnings.view_own')
  get(@CurrentAuth() auth: AuthContext) {
    return this.service.rider(auth);
  }

  @Get('payouts/:id')
  @RequirePermission('earnings.view_own')
  payout(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.statement(auth, id);
  }
}

@Module({
  imports: [AdminModule],
  controllers: [RestaurantPayoutsController, RiderEarningsController],
  providers: [
    {
      provide: PayoutsService,
      inject: [DB, SettlementsService],
      useFactory: (db: Db, settlements: SettlementsService) => new PayoutsService(db, settlements),
    },
  ],
})
export class PayoutsModule {}
