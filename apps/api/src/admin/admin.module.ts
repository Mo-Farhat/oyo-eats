import {
  Body,
  Controller,
  Header,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  can,
  settlementPaidSchema,
  type SettlementPaidInput,
  generateSettlementsSchema,
  type GenerateSettlementsInput,
  cashHandoverSchema,
  type CashHandoverInput,
  adminOrderActionSchema,
  type AdminOrderActionInput,
  accountStatusSchema,
  categoryInputSchema,
  createAccountSchema,
  hoursSchema,
  menuItemInputSchema,
  menuItemUpdateSchema,
  restaurantInputSchema,
  restaurantStatusSchema,
  restaurantUpdateSchema,
  ROLES,
  type CreateAccountInput,
  type HoursInput,
  type MenuItemInput,
  type MenuItemUpdate,
  type RestaurantInput,
  type RestaurantUpdate,
  type Role,
} from '@oyo/shared';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { CONFIG, DB } from '../tokens.js';
import { OrdersModule } from '../orders/orders.module.js';
import { OrdersService } from '../orders/orders.service.js';
import { AccountsService } from './accounts.service.js';
import { AdminOrdersService } from './orders.service.js';
import { AdminRidersService } from './riders.service.js';
import { SettlementsService } from './settlements.service.js';
import { ApiError } from '../common/api-error.js';
import { Idempotent } from '../common/idempotency.js';
import { AdminRestaurantsService } from './restaurants.service.js';

const isUuid = (s: unknown): s is string =>
  typeof s === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** Logins for riders, restaurants and dispatchers (ADM-08). Per-role rules are in the service. */
@Controller('admin')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly service: AccountsService) {}

  @Post('accounts')
  @RequirePermission('accounts.create_rider')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createAccountSchema)) body: CreateAccountInput,
  ) {
    return this.service.create(auth, body);
  }

  @Get('accounts')
  @RequirePermission('accounts.create_rider')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query('role') role?: string,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.service.list(auth, {
      role: (ROLES as readonly string[]).includes(role ?? '') ? (role as Role) : undefined,
      tenantId: isUuid(tenantId) ? tenantId : undefined,
    });
  }

  @Post('accounts/:id/reset-password')
  @RequirePermission('accounts.create_rider')
  reset(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.resetPassword(auth, id);
  }

  @Post('accounts/:id/status')
  @HttpCode(204)
  @RequirePermission('accounts.create_rider')
  async status(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(accountStatusSchema)) body: z.infer<typeof accountStatusSchema>,
  ) {
    await this.service.setActive(auth, id, body.active);
  }

  @Post('devices/:id/approve')
  @HttpCode(204)
  @RequirePermission('accounts.create_rider')
  async approve(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.service.decideDevice(auth, id, true);
  }

  @Post('devices/:id/reject')
  @HttpCode(204)
  @RequirePermission('accounts.create_rider')
  async reject(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.service.decideDevice(auth, id, false);
  }
}

/** Restaurant onboarding and profile (ADM-11, ADM-12). Owner only. */
@Controller('admin/restaurants')
export class AdminRestaurantsController {
  constructor(@Inject(AdminRestaurantsService) private readonly service: AdminRestaurantsService) {}

  @Get()
  @RequirePermission('restaurants.manage')
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermission('restaurants.manage')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(restaurantInputSchema)) body: RestaurantInput,
  ) {
    return this.service.create(auth, body);
  }

  @Get(':id')
  @RequirePermission('restaurants.manage')
  get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.get(auth, id);
  }

  @Patch(':id')
  @RequirePermission('restaurants.manage')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(restaurantUpdateSchema)) body: RestaurantUpdate,
  ) {
    return this.service.update(auth, id, body);
  }

  @Post(':id/status')
  @RequirePermission('restaurants.manage')
  status(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(restaurantStatusSchema)) body: z.infer<typeof restaurantStatusSchema>,
  ) {
    return this.service.setStatus(auth, id, body.status);
  }

  @Post(':id/hours')
  @RequirePermission('restaurants.manage')
  hours(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(hoursSchema)) body: HoursInput,
  ) {
    return this.service.setHours(auth, id, body);
  }

  @Post(':id/categories')
  @RequirePermission('restaurants.manage')
  category(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(categoryInputSchema)) body: z.infer<typeof categoryInputSchema>,
  ) {
    return this.service.addCategory(auth, id, body);
  }

  @Post(':id/items')
  @RequirePermission('restaurants.manage')
  item(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(menuItemInputSchema)) body: MenuItemInput,
  ) {
    return this.service.addItem(auth, id, body);
  }

  @Patch(':id/items/:itemId')
  @HttpCode(204)
  @RequirePermission('restaurants.manage')
  async updateItem(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('itemId', UuidPipe) itemId: string,
    @Body(new ZodPipe(menuItemUpdateSchema)) body: MenuItemUpdate,
  ) {
    await this.service.updateItem(auth, id, itemId, body);
  }
}

/** A02 order detail and the dispatch actions on it (A22, basic). */
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(@Inject(AdminOrdersService) private readonly service: AdminOrdersService) {}

  @Get(':id')
  @RequirePermission('orders.view_all')
  get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.get(auth, id);
  }

  @Post(':id/cancel')
  @RequirePermission('orders.cancel')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(adminOrderActionSchema)) body: AdminOrderActionInput,
  ) {
    return this.service.cancel(auth, id, body.reason);
  }

  @Post(':id/failed')
  @RequirePermission('orders.cancel')
  failed(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(adminOrderActionSchema)) body: AdminOrderActionInput,
  ) {
    return this.service.markFailed(auth, id, body.reason);
  }
}

/** A08, A09, A11: riders and cash handovers (ADM-07, ADM-09). */
@Controller('admin')
export class AdminRidersController {
  constructor(@Inject(AdminRidersService) private readonly service: AdminRidersService) {}

  @Get('riders')
  @RequirePermission('riders.view')
  list() {
    return this.service.list();
  }

  @Get('riders/:id')
  @RequirePermission('riders.view')
  get(@Param('id', UuidPipe) id: string) {
    return this.service.get(id);
  }

  @Post('riders/:id/handover')
  @Idempotent()
  @RequirePermission('cash_handover.record')
  handover(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(cashHandoverSchema)) body: CashHandoverInput,
  ) {
    return this.service.recordHandover(auth, id, body);
  }

  @Post('handovers/:id/countersign')
  @RequirePermission('cash.write_off')
  countersign(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.countersign(auth, id);
  }

  @Post('riders/:id/offline')
  @RequirePermission('riders.manage_status')
  offline(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.forceOffline(auth, id);
  }
}

/** A16 restaurant statements and A17 rider payouts (ADM-13, ADM-14). Owner only. */
@Controller('admin/settlements')
export class SettlementsController {
  constructor(@Inject(SettlementsService) private readonly service: SettlementsService) {}

  /** Rider payouts need their own permission on top of settlements. */
  private check(auth: AuthContext, party: string) {
    if (party === 'rider' && !can(auth.role, 'rider_payouts.manage'))
      throw new ApiError('forbidden');
  }

  @Get()
  @RequirePermission('settlements.manage')
  list(@CurrentAuth() auth: AuthContext, @Query('party') party?: string) {
    const p = party === 'rider' ? 'rider' : 'restaurant';
    this.check(auth, p);
    return this.service.list(p);
  }

  @Post('generate')
  @RequirePermission('settlements.manage')
  generate(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(generateSettlementsSchema)) body: GenerateSettlementsInput,
  ) {
    this.check(auth, body.party);
    return this.service.generate(auth, body);
  }

  @Get(':id')
  @RequirePermission('settlements.manage')
  async get(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    const d = await this.service.get(id);
    this.check(auth, d.party);
    return d;
  }

  @Get(':id/csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @RequirePermission('settlements.manage')
  async csv(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    this.check(auth, (await this.service.get(id)).party);
    return this.service.csv(id);
  }

  @Post(':id/review')
  @RequirePermission('settlements.manage')
  async review(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    this.check(auth, (await this.service.get(id)).party);
    return this.service.review(auth, id);
  }

  @Post(':id/paid')
  @Idempotent()
  @RequirePermission('settlements.manage')
  async paid(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(settlementPaidSchema)) body: SettlementPaidInput,
  ) {
    this.check(auth, (await this.service.get(id)).party);
    return this.service.markPaid(auth, id, body.reference);
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [
    AccountsController,
    AdminRestaurantsController,
    AdminOrdersController,
    AdminRidersController,
    SettlementsController,
  ],
  providers: [
    {
      provide: AccountsService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: Config) => new AccountsService(db, config.encryptionKey),
    },
    {
      provide: AdminRestaurantsService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: Config) => new AdminRestaurantsService(db, config.encryptionKey),
    },
    {
      provide: SettlementsService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: Config) => new SettlementsService(db, config.encryptionKey),
    },
    {
      provide: AdminRidersService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: Config) => new AdminRidersService(db, config.encryptionKey),
    },
    {
      provide: AdminOrdersService,
      inject: [DB, CONFIG, OrdersService],
      useFactory: (db: Db, config: Config, orders: OrdersService) =>
        new AdminOrdersService(db, config.encryptionKey, orders),
    },
  ],
})
export class AdminModule {}
