import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { CONFIG, DB, JOBS } from '../tokens.js';
import { runMaintenance } from './maintenance.js';
import { RecordingJobQueue, type JobQueue } from './queue.js';

/*
 * Timers and background work on pg-boss, which keeps its queues in the `pgboss` schema of the same
 * Postgres (no Redis). It connects with the owner role and the direct connection string.
 * Features register handlers with `define()` in onModuleInit; queues and workers start at bootstrap.
 */
@Injectable()
export class PgBossJobs implements JobQueue, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, (data: object) => Promise<void>>();
  private readonly crons = new Map<string, string>([['maintenance', '17 * * * *']]);
  readonly boss: PgBoss;

  constructor(
    @Inject(CONFIG) config: Config,
    @Inject(DB) private readonly db: Db,
  ) {
    this.boss = new PgBoss({ connectionString: config.databaseUrl, schema: 'pgboss', max: 4 });
    this.boss.on('error', (error) => this.logger.error(error));
    this.define('maintenance', async () => {
      this.logger.log(`maintenance: ${JSON.stringify(await runMaintenance(this.db, new Date()))}`);
    });
  }

  define<T extends object>(queue: string, handler: (data: T) => Promise<void>): void {
    this.handlers.set(queue, handler as (data: object) => Promise<void>);
  }

  schedule(queue: string, cron: string): void {
    this.crons.set(queue, cron);
  }

  async sendAfter(queue: string, data: object, seconds: number): Promise<void> {
    await this.boss.sendAfter(queue, data, { retryLimit: 3 }, seconds);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.start();
    for (const [queue, handler] of this.handlers) {
      await this.boss.createQueue(queue);
      await this.boss.work<object>(queue, async (jobs) => {
        for (const job of jobs) await handler(job.data);
      });
    }
    for (const [queue, cron] of this.crons)
      await this.boss.schedule(queue, cron, null, { tz: 'Asia/Colombo' });
    this.logger.log(`pg-boss started: ${[...this.handlers.keys()].join(', ')}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}

@Global()
@Module({})
export class JobsModule {
  static forRoot(enabled: boolean, recorder?: RecordingJobQueue): DynamicModule {
    return {
      module: JobsModule,
      providers: enabled
        ? [PgBossJobs, { provide: JOBS, useExisting: PgBossJobs }]
        : [{ provide: JOBS, useValue: recorder ?? new RecordingJobQueue() }],
      exports: [JOBS],
    };
  }
}
