/** Environment config, read once at startup. Fails fast on anything missing or malformed. */
export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  /** HMAC key for phone lookups and OTP codes (32 bytes, base64). */
  hashKey: Buffer;
  /** AES-256-GCM key for application-layer encryption (32 bytes, base64). */
  encryptionKey: Buffer;
  /** Express "trust proxy" hops, so the client IP is right behind Render's proxy. */
  trustProxy: number;
  /** Public base URL of this API, for signed file links. */
  publicUrl: string;
  /** Development file storage folder (R2 replaces it in production). */
  uploadDir: string;
  /** Cloudflare R2; required in production. */
  r2?: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
  /** Notify.lk SMS; required in production. */
  notifyLk?: { userId: string; apiKey: string; senderId: string };
  /** Google Routes API key; without it distances are straight-line x 1.3. */
  googleRoutesKey?: string;
}

/** All of a group of variables, or none (half-configured is an error). */
function group<K extends string>(names: Record<K, string>): Record<K, string> | undefined {
  const values = Object.fromEntries(
    Object.entries(names).map(([k, env]) => [k, process.env[env as string]]),
  );
  const set = Object.values(values).filter(Boolean).length;
  if (set === 0) return undefined;
  if (set !== Object.keys(names).length) {
    throw new Error(`Set all or none of: ${Object.values(names).join(', ')}`);
  }
  return values as Record<K, string>;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function key(name: string): Buffer {
  const buf = Buffer.from(required(name), 'base64');
  if (buf.length !== 32) throw new Error(`${name} must be 32 bytes, base64-encoded`);
  return buf;
}

export function loadConfig(): Config {
  const env = process.env.NODE_ENV ?? 'development';
  if (env !== 'development' && env !== 'test' && env !== 'production') {
    throw new Error(`Unknown NODE_ENV ${env}`);
  }
  const config: Config = {
    env,
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    hashKey: key('HASH_KEY'),
    encryptionKey: key('ENCRYPTION_KEY'),
    trustProxy: Number(process.env.TRUST_PROXY ?? 0),
    publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    uploadDir: process.env.UPLOAD_DIR ?? '.uploads',
    r2: group({
      accountId: 'R2_ACCOUNT_ID',
      accessKeyId: 'R2_ACCESS_KEY_ID',
      secretAccessKey: 'R2_SECRET_ACCESS_KEY',
      bucket: 'R2_BUCKET',
    }),
    notifyLk: group({
      userId: 'NOTIFYLK_USER_ID',
      apiKey: 'NOTIFYLK_API_KEY',
      senderId: 'NOTIFYLK_SENDER_ID',
    }),
    googleRoutesKey: process.env.GOOGLE_ROUTES_API_KEY || undefined,
  };
  if (config.env === 'production') {
    const missing = [
      !config.r2 && 'R2_*',
      !config.notifyLk && 'NOTIFYLK_*',
      !process.env.PUBLIC_URL && 'PUBLIC_URL',
    ].filter(Boolean);
    if (missing.length)
      throw new Error(`Production needs: ${missing.join(', ')} (docs/SETUP-PROVIDERS.md)`);
  }
  return config;
}
