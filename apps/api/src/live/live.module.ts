import { Module, type DynamicModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LiveBus } from './live.bus.js';
import { LiveGateway } from './live.gateway.js';
import { LiveListener } from './live.listener.js';

@Module({})
export class LiveModule {
  /** The listener is off in tests (their transactions roll back, so nothing is ever notified). */
  static forRoot(listen: boolean): DynamicModule {
    return {
      module: LiveModule,
      global: true,
      imports: [AuthModule],
      providers: [LiveBus, LiveGateway, ...(listen ? [LiveListener] : [])],
      exports: [LiveBus, LiveGateway],
    };
  }
}
