import { Controller, Get, Inject, Module, Post, type OnModuleInit } from '@nestjs/common';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import type { Db } from '../db/client.js';
import type { JobQueue } from '../jobs/queue.js';
import { DB, JOBS } from '../tokens.js';
import {
  RECONCILIATION_QUEUE,
  ReconciliationService,
  yesterdayInColombo,
} from './reconciliation.service.js';

/** The books check for the owner: the last two weeks, and run it now for yesterday. */
@Controller('admin/reconciliation')
export class ReconciliationController {
  constructor(@Inject(ReconciliationService) private readonly service: ReconciliationService) {}

  @Get()
  @RequirePermission('reports.view')
  list() {
    return this.service.latest();
  }

  @Post()
  @RequirePermission('reports.view')
  run(@CurrentAuth() auth: AuthContext) {
    return this.service.run(yesterdayInColombo(), auth);
  }
}

/** 03:30 every night, Asia/Colombo, for the day before. */
class NightlyReconciliation implements OnModuleInit {
  constructor(
    @Inject(JOBS) private readonly jobs: JobQueue,
    @Inject(ReconciliationService) private readonly service: ReconciliationService,
  ) {}

  onModuleInit() {
    this.jobs.define(RECONCILIATION_QUEUE, async () => {
      await this.service.run(yesterdayInColombo());
    });
    this.jobs.schedule(RECONCILIATION_QUEUE, '30 3 * * *');
  }
}

@Module({
  controllers: [ReconciliationController],
  providers: [
    {
      provide: ReconciliationService,
      inject: [DB],
      useFactory: (db: Db) => new ReconciliationService(db),
    },
    NightlyReconciliation,
  ],
})
export class ReconciliationModule {}
