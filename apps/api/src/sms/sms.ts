/** SMS gateway behind an interface; the provider is still to be picked (open decision 2). */
export interface SmsSender {
  send(phoneE164: string, text: string): Promise<void>;
}

/**
 * Development stub: prints the message to the console. Logging an OTP breaks SEC-19, so this
 * refuses to run in production.
 */
export class ConsoleSmsSender implements SmsSender {
  constructor(env: string) {
    if (env === 'production') throw new Error('ConsoleSmsSender must not be used in production');
  }

  async send(phoneE164: string, text: string): Promise<void> {
    console.log(`[sms:dev] to ${phoneE164}: ${text}`);
  }
}
