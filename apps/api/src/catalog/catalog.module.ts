import { Controller, Get, Inject, Module, Param, Query } from '@nestjs/common';
import { pointQuerySchema, restaurantQuerySchema, type RestaurantQuery } from '@oyo/shared';
import type { z } from 'zod';
import { SignedIn } from '../auth/decorators.js';
import { UuidPipe } from '../common/uuid.pipe.js';
import { ZodPipe } from '../common/zod.pipe.js';
import type { Db } from '../db/client.js';
import type { Routing } from '../routing/routing.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { DB, ROUTING } from '../tokens.js';
import { CatalogService } from './catalog.service.js';

@Controller('restaurants')
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ReviewsService) private readonly reviews: ReviewsService,
  ) {}

  /** Restaurant reviews (CUS-20). */
  @Get(':id/reviews')
  @SignedIn()
  reviewsFor(@Param('id', UuidPipe) id: string) {
    return this.reviews.forRestaurant(id);
  }

  @Get()
  @SignedIn()
  list(@Query(new ZodPipe(restaurantQuerySchema)) query: RestaurantQuery) {
    return this.catalog.list(query);
  }

  @Get(':id')
  @SignedIn()
  get(
    @Param('id', UuidPipe) id: string,
    @Query(new ZodPipe(pointQuerySchema)) q: z.infer<typeof pointQuerySchema>,
  ) {
    return this.catalog.get(
      id,
      q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined,
    );
  }
}

@Module({
  controllers: [CatalogController],
  providers: [
    {
      provide: CatalogService,
      inject: [DB, ROUTING],
      useFactory: (db: Db, routing: Routing) => new CatalogService(db, routing),
    },
    { provide: ReviewsService, inject: [DB], useFactory: (db: Db) => new ReviewsService(db) },
  ],
})
export class CatalogModule {}
