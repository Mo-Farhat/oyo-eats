import type { SmsSender } from './sms.js';

export interface NotifyLkConfig {
  userId: string;
  apiKey: string;
  /** The approved sender ID (takes Notify.lk a few days to register). */
  senderId: string;
}

/**
 * Notify.lk (open decision 2). Their send endpoint takes the number without "+" (94771234567).
 * Check the request shape against Notify.lk's current API docs when the account is created.
 */
export class NotifyLkSender implements SmsSender {
  constructor(
    private readonly config: NotifyLkConfig,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  async send(phoneE164: string, text: string): Promise<void> {
    const params = new URLSearchParams({
      user_id: this.config.userId,
      api_key: this.config.apiKey,
      sender_id: this.config.senderId,
      to: phoneE164.replace(/^\+/, ''),
      message: text,
    });
    const res = await this.doFetch(`https://app.notify.lk/api/v1/send?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    // Never log the message: it carries the OTP (SEC-19).
    if (!res.ok || body.status !== 'success')
      throw new Error(`Notify.lk send failed (HTTP ${res.status})`);
  }
}
