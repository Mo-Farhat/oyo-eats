import { Global, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import type { Config } from '../config.js';
import { CONFIG, DB } from '../tokens.js';
import { createDb, createPool, type Database } from './client.js';

class PoolCloser implements OnApplicationShutdown {
  constructor(private readonly pool: pg.Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({})
export class DbModule {
  /** The real pool, from DATABASE_URL. */
  static fromConfig(): DynamicModule {
    const POOL = Symbol('POOL');
    return {
      module: DbModule,
      providers: [
        {
          provide: POOL,
          inject: [CONFIG],
          useFactory: (config: Config) => createPool(config.databaseUrl),
        },
        { provide: DB, inject: [POOL], useFactory: createDb },
        {
          provide: PoolCloser,
          inject: [POOL],
          useFactory: (pool: pg.Pool) => new PoolCloser(pool),
        },
      ],
      exports: [DB],
    };
  }

  /** A given handle, e.g. a transaction that a test rolls back. */
  static fromHandle(db: Database): DynamicModule {
    return { module: DbModule, providers: [{ provide: DB, useValue: db }], exports: [DB] };
  }
}
