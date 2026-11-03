import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  historyQuerySchema,
  reviewReplySchema,
  hoursOverrideSchema,
  hoursSchema,
  itemStockSchema,
  menuEditRequestSchema,
  menuItemInputSchema,
  restaurantCategorySchema,
  type HoursInput,
  type HoursOverrideInput,
  type MenuEditRequestInput,
  type MenuItemInput,
} from '@oyo/shared';
import type { z } from 'zod';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RestaurantInsightsService } from './insights.service.js';
import { RestaurantMenuService } from './menu.service.js';

/** T07-T10: the restaurant's menu, change requests and hours (RES-08 to RES-10). */
@Controller('restaurant')
export class RestaurantMenuController {
  constructor(@Inject(RestaurantMenuService) private readonly service: RestaurantMenuService) {}

  @Get('menu')
  @RequirePermission('restaurant.menu.edit')
  menu(@CurrentAuth() auth: AuthContext) {
    return this.service.menu(auth);
  }

  @Post('menu/categories')
  @RequirePermission('restaurant.menu.edit')
  category(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(restaurantCategorySchema)) body: z.infer<typeof restaurantCategorySchema>,
  ) {
    return this.service.addCategory(auth, body.name);
  }

  @Post('menu/items')
  @RequirePermission('restaurant.menu.edit')
  addItem(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(menuItemInputSchema)) body: MenuItemInput,
  ) {
    return this.service.addItem(auth, body);
  }

  @Post('menu/items/:id/stock')
  @HttpCode(204)
  @RequirePermission('restaurant.menu.edit')
  async stock(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(itemStockSchema)) body: z.infer<typeof itemStockSchema>,
  ) {
    await this.service.setStock(auth, id, body.soldOut);
  }

  @Post('menu/items/:id/changes')
  @RequirePermission('restaurant.menu.edit')
  change(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(menuEditRequestSchema)) body: MenuEditRequestInput,
  ) {
    return this.service.requestChange(auth, id, body);
  }

  @Get('menu/requests')
  @RequirePermission('restaurant.menu.edit')
  requests(@CurrentAuth() auth: AuthContext) {
    return this.service.requests(auth);
  }

  @Delete('menu/requests/:id')
  @HttpCode(204)
  @RequirePermission('restaurant.menu.edit')
  async withdraw(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    await this.service.withdraw(auth, id);
  }

  @Get('hours')
  @RequirePermission('restaurant.hours.edit')
  hours(@CurrentAuth() auth: AuthContext) {
    return this.service.hours(auth);
  }

  @Put('hours')
  @RequirePermission('restaurant.hours.edit')
  setHours(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(hoursSchema)) body: HoursInput) {
    return this.service.setHours(auth, body);
  }

  @Post('hours/closures')
  @RequirePermission('restaurant.hours.edit')
  addClosure(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(hoursOverrideSchema)) body: HoursOverrideInput,
  ) {
    return this.service.addClosure(auth, body);
  }

  @Delete('hours/closures/:id')
  @RequirePermission('restaurant.hours.edit')
  removeClosure(@CurrentAuth() auth: AuthContext, @Param('id', UuidPipe) id: string) {
    return this.service.removeClosure(auth, id);
  }
}

/** T12: reviews with replies (RES-12), order history and daily sales (RES-13). */
@Controller('restaurant')
export class RestaurantInsightsController {
  constructor(
    @Inject(RestaurantInsightsService) private readonly service: RestaurantInsightsService,
  ) {}

  @Get('reviews')
  @RequirePermission('restaurant.orders.view')
  reviews(@CurrentAuth() auth: AuthContext) {
    return this.service.reviews(auth);
  }

  @Post('reviews/:id/reply')
  @HttpCode(204)
  @RequirePermission('restaurant.reviews.reply')
  async reply(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(reviewReplySchema)) body: z.infer<typeof reviewReplySchema>,
  ) {
    await this.service.reply(auth, id, body.reply);
  }

  @Get('history')
  @RequirePermission('restaurant.orders.view')
  history(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(historyQuerySchema)) q: z.infer<typeof historyQuerySchema>,
  ) {
    return this.service.history(auth, q.from, q.to);
  }

  @Get('history/csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  @RequirePermission('restaurant.orders.view')
  historyCsv(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(historyQuerySchema)) q: z.infer<typeof historyQuerySchema>,
  ) {
    return this.service.historyCsv(auth, q.from, q.to);
  }
}
