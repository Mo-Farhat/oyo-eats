import { Logger } from '@nestjs/common';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  /** High priority wakes the phone (offers, new orders, rider assigned). */
  critical: boolean;
}

export interface PushResult {
  ok: boolean;
  error?: string;
  /** The token is dead (app uninstalled): drop it. */
  unregistered?: boolean;
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

/** Development: logs instead of sending. */
export class ConsolePushSender implements PushSender {
  private readonly log = new Logger('Push');
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    for (const m of messages) this.log.log(`→ ${m.to.slice(0, 22)}… ${m.title}: ${m.body}`);
    return messages.map(() => ({ ok: true }));
  }
}

/** Expo's push service (FCM and APNs behind it). https://docs.expo.dev/push-notifications/sending-notifications/ */
export class ExpoPushSender implements PushSender {
  constructor(
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    // Expo takes up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = await this.fetchImpl('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(
            batch.map((m) => ({
              to: m.to,
              title: m.title,
              body: m.body,
              data: m.data,
              sound: 'default',
              priority: m.critical ? 'high' : 'default',
              channelId: m.critical ? 'critical' : 'default',
            })),
          ),
          signal: AbortSignal.timeout(10_000),
        });
        const json = (await res.json()) as {
          data?: { status: 'ok' | 'error'; message?: string; details?: { error?: string } }[];
        };
        if (!res.ok || !json.data) throw new Error(`Expo push ${res.status}`);
        for (const t of json.data) {
          out.push(
            t.status === 'ok'
              ? { ok: true }
              : {
                  ok: false,
                  error: t.details?.error ?? t.message ?? 'error',
                  unregistered: t.details?.error === 'DeviceNotRegistered',
                },
          );
        }
      } catch (e) {
        for (const _ of batch) out.push({ ok: false, error: String(e) });
      }
    }
    return out;
  }
}
