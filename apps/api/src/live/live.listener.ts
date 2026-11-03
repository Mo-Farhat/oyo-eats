import { Inject, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import type { Config } from '../config.js';
import { CONFIG } from '../tokens.js';
import { LiveBus } from './live.bus.js';
import { LiveGateway } from './live.gateway.js';
import type { LiveNotice } from './rooms.js';

/**
 * Listens on Postgres channel oyo_live (NOTIFY is delivered only on commit) and hands each notice
 * to the gateway. One dedicated connection; reconnects with backoff if it drops. Needs the direct
 * Neon host (the pooler can't LISTEN).
 */
export class LiveListener implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Live');
  private client: pg.Client | null = null;
  private stopped = false;
  private backoff = 1_000;

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LiveGateway) private readonly gateway: LiveGateway,
    @Inject(LiveBus) private readonly bus: LiveBus,
  ) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    this.stopped = true;
    await this.client?.end().catch(() => undefined);
  }

  private async connect() {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.config.databaseUrl });
    client.on('notification', (msg) => {
      if (msg.channel !== 'oyo_live' || !msg.payload) return;
      try {
        const notice = JSON.parse(msg.payload) as LiveNotice;
        this.gateway.publish(notice);
        this.bus.emit(notice);
      } catch (e) {
        this.log.warn(`Bad live payload: ${String(e)}`);
      }
    });
    const retry = () => {
      if (this.stopped || this.client !== client) return;
      this.client = null;
      setTimeout(() => void this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
    client.on('error', (e) => {
      this.log.warn(`Listener error: ${e.message}`);
      retry();
    });
    client.on('end', retry);
    try {
      this.client = client;
      await client.connect();
      await client.query('LISTEN oyo_live');
      this.backoff = 1_000;
      this.log.log('Listening for live updates');
    } catch (e) {
      this.log.warn(`Listener can't connect: ${String(e)}`);
      await client.end().catch(() => undefined);
      retry();
    }
  }
}
