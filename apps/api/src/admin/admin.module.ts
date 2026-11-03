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
  Put,
  Query,
} from '@nestjs/common';
import {
  can,
  reportQuerySchema,
  customerBlockSchema,
  customerCodSchema,
  customerFlagSchema,
  restaurantStaffSchema,
  reviewHiddenSchema,
  adminSettingsSchema,
  type AdminSettings,
  menuReviewSchema,
  type MenuReviewInput,
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
import { MenuApprovalsService } from './menu-approvals.service.js';
import { SettingsAdminService } from './settings.service.js';
import { CustomersService } from './customers.service.js';
import { ReportsService } from './reports.service.js';
import { setReviewHidden } from '../restaurant/insights.service.js';
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

/** A15 menu approvals (ADM-12). Owner only. */
@Controller('admin/menu-requests')
export class MenuApprovalsController {
  constructor(@Inject(MenuApprovalsService) private readonly service: MenuApprovalsService) {}

  @Get()
  @RequirePermission('menu_approvals.review')
  list() {
    return this.service.list();
  }

  @Post(':id/review')
  @RequirePermission('menu_approvals.review')
  review(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(menuReviewSchema)) body: MenuReviewInput,
  ) {
    return this.service.review(auth, id, body);
  }
}

/** A20 settings (ADM-18). Owner only. */
@Controller('admin/settings')
export class SettingsController {
  constructor(@Inject(SettingsAdminService) private readonly service: SettingsAdminService) {}

  @Get()
  @RequirePermission('settings.edit')
  get() {
    return this.service.get();
  }

  @Put()
  @RequirePermission('settings.edit')
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(adminSettingsSchema)) body: AdminSettings,
  ) {
    return this.service.update(auth, body);
  }
}

/** RES-01: a restaurant owner's own staff logins (create, reset, switch off, approve a tablet). */
@Controller('restaurant/staff')
export class RestaurantStaffController {
  constructor(@Inject(AccountsService) private readonly service: AccountsService) {}

  @Get()
  @RequirePermission('restaurant.staff.manage')
  list(@CurrentAuth() auth: AuthContext) {
    return this.service.list(auth);
  }

  @Post()
  @RequirePermission('restaurant.staff.manage')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(restaurantStaffSchema)) body: z.infer<typeof restaurantStaffSchema>,
  ) {
    return this.service.create(auth, {
      role: 'restaurant_staff',
      ...body,
      tenantId: auth.tenantId!,
    });
  }

  @Post(':id/reset-password')
  @RequirePermission('restaurant.staff.manage')
  reset(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.resetPassword(auth, id);
  }

  @Post(':id/status')
  @HttpCode(204)
  @RequirePermission('restaurant.staff.manage')
  async status(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(accountStatusSchema)) body: z.infer<typeof accountStatusSchema>,
  ) {
    await this.service.setActive(auth, id, body.active);
  }

  @Post('devices/:id/:decision')
  @HttpCode(204)
  @RequirePermission('restaurant.staff.manage')
  async device(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('decision') decision: string,
  ) {
    if (decision !== 'approve' && decision !== 'reject') throw new ApiError('not_found');
    await this.service.decideDevice(auth, id, decision === 'approve');
  }
}

/** RES-12: hide an abusive review (kept on record). */
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post(':id/hidden')
  @HttpCode(204)
  @RequirePermission('support.manage')
  async hide(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(reviewHiddenSchema)) body: z.infer<typeof reviewHiddenSchema>,
  ) {
    await setReviewHidden(this.db, auth, id, body.hidden);
  }
}

/** A18 customers (ADM-15). Search and flag: dispatch; block: owner. */
@Controller('admin/customers')
export class CustomersController {
  constructor(@Inject(CustomersService) private readonly service: CustomersService) {}

  @Get()
  @RequirePermission('customers.view')
  search(@Query('q') q?: string) {
    return this.service.search(typeof q === 'string' ? q.slice(0, 60) : undefined);
  }

  @Get(':id')
  @RequirePermission('customers.view')
  get(@Param('id', UuidPipe) id: string) {
    return this.service.get(id);
  }

  @Post(':id/flag')
  @RequirePermission('customers.flag')
  flag(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(customerFlagSchema)) body: z.infer<typeof customerFlagSchema>,
  ) {
    return this.service.flag(auth, id, body.note);
  }

  @Post(':id/cod')
  @RequirePermission('customers.flag')
  cod(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(customerCodSchema)) body: z.infer<typeof customerCodSchema>,
  ) {
    return this.service.setCod(auth, id, body.allowed);
  }

  @Post(':id/block')
  @RequirePermission('customers.block')
  block(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(customerBlockSchema)) body: z.infer<typeof customerBlockSchema>,
  ) {
    return this.service.setBlocked(auth, id, body.blocked, body.reason);
  }
}

/** A19 reports (ADM-17) and the audit log (SEC-31). Owner only. */
@Controller('admin')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly service: ReportsService) {}

  @Get('reports')
  @RequirePermission('reports.view')
  report(@Query(new ZodPipe(reportQuerySchema)) q: z.infer<typeof reportQuerySchema>) {
    return this.service.report(q.from, q.to);
  }

  @Get('reports/csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @RequirePermission('reports.view')
  csv(@Query(new ZodPipe(reportQuerySchema)) q: z.infer<typeof reportQuerySchema>) {
    return this.service.csv(q.from, q.to);
  }

  @Get('audit')
  @RequirePermission('audit_log.view')
  audit(@Query('action') action?: string) {
    return this.service.audit(
      typeof action === 'string' && /^[a-z_.]{1,40}$/.test(action) ? action : undefined,
    );
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
    MenuApprovalsController,
    SettingsController,
    RestaurantStaffController,
    AdminReviewsController,
    CustomersController,
    ReportsController,
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
      provide: ReportsService,
      inject: [DB],
      useFactory: (db: Db) => new ReportsService(db),
    },
    {
      provide: CustomersService,
      inject: [DB, CONFIG],
      useFactory: (db: Db, config: Config) =>
        new CustomersService(db, { hashKey: config.hashKey, encryptionKey: config.encryptionKey }),
    },
    {
      provide: SettingsAdminService,
      inject: [DB],
      useFactory: (db: Db) => new SettingsAdminService(db),
    },
    {
      provide: MenuApprovalsService,
      inject: [DB],
      useFactory: (db: Db) => new MenuApprovalsService(db),
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
  exports: [SettlementsService],
})
export class AdminModule {}
