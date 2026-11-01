import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { AdminModule } from './admin/admin.module.js';
import { AddressesModule } from './addresses/addresses.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { DbModule } from './db/db.module.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { HealthController } from './health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import type { RecordingJobQueue } from './jobs/queue.js';
import { OrdersModule } from './orders/orders.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ProfileModule } from './profile/profile.module.js';
import { RestaurantModule } from './restaurant/restaurant.module.js';
import { GoogleRouting } from './routing/google.js';
import { StraightLineRouting, type Routing } from './routing/routing.js';
import { NotifyLkSender } from './sms/notifylk.js';
import { R2Storage } from './storage/r2.js';
import { ConsoleSmsSender, type SmsSender } from './sms/sms.js';
import { LocalDiskStorage, type FileStorage } from './storage/storage.js';
import { StorageModule } from './storage/storage.module.js';
import { CONFIG, ROUTING, SMS, STORAGE } from './tokens.js';

export interface AppOptions {
  /** Use this database handle instead of a pool (tests pass a transaction). */
  db?: Database;
  /** Start pg-boss. When false, jobs are recorded instead (pass `recorder` to inspect them). */
  jobs?: boolean;
  recorder?: RecordingJobQueue;
  /** Road distances. Defaults to the straight-line placeholder until Google Routes is set up. */
  routing?: Routing;
  /** SMS sender. Defaults to the console stub (development only). */
  sms?: SmsSender;
  /** Private file storage. Defaults to local disk under config.uploadDir. */
  storage?: FileStorage;
  /** Extra modules, for test-only controllers. */
  imports?: Type[];
}

@Module({})
export class AppModule {
  static forRoot(config: Config, options: AppOptions = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        options.db ? DbModule.fromHandle(options.db) : DbModule.fromConfig(),
        JobsModule.forRoot(options.jobs !== false, options.recorder),
        AuthModule,
        CatalogModule,
        AddressesModule,
        OrdersModule,
        PaymentsModule,
        ProfileModule,
        RestaurantModule,
        DispatchModule,
        AdminModule,
        StorageModule,
        ...(options.imports ?? []),
      ],
      controllers: [HealthController],
      providers: [
        { provide: CONFIG, useValue: config },
        {
          provide: ROUTING,
          useValue:
            options.routing ??
            (config.googleRoutesKey
              ? new GoogleRouting(config.googleRoutesKey)
              : new StraightLineRouting()),
        },
        {
          provide: SMS,
          useFactory: () =>
            options.sms ??
            (config.notifyLk
              ? new NotifyLkSender(config.notifyLk)
              : new ConsoleSmsSender(config.env)),
        },
        {
          provide: STORAGE,
          useFactory: () =>
            options.storage ??
            (config.r2
              ? new R2Storage(config.r2)
              : new LocalDiskStorage(config.uploadDir, config.hashKey, config.publicUrl)),
        },
      ],
      exports: [CONFIG, ROUTING, SMS, STORAGE],
    };
  }
}
