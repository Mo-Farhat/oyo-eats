import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Private file storage (SEC-17): bank slips, rider documents, menu photos. Files are never
 * public; clients get short-lived signed URLs. Local disk in development; Cloudflare R2 in
 * production (docs/NEEDS-YOU.md).
 */
export interface FileStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  /** A URL that works for `ttlSeconds`. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

export function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error(`Bad storage key ${key}`);
}

/** Development storage: files under a local folder, served by GET /files/:key with an HMAC. */
export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(
    root: string,
    private readonly signingKey: Buffer,
    private readonly baseUrl: string,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.root = resolve(root);
  }

  private path(key: string) {
    assertKey(key);
    return join(this.root, key);
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    await writeFile(`${path}.type`, contentType);
  }

  async get(key: string) {
    try {
      const path = this.path(key);
      return {
        data: await readFile(path),
        contentType: (await readFile(`${path}.type`, 'utf8')).trim(),
      };
    } catch {
      return null;
    }
  }

  private signature(key: string, expires: number) {
    return createHmac('sha256', this.signingKey)
      .update(`file:${key}:${expires}`)
      .digest('base64url');
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertKey(key);
    const expires = Math.floor(this.clock().getTime() / 1000) + ttlSeconds;
    return `${this.baseUrl}/files/${encodeURIComponent(key)}?expires=${expires}&sig=${this.signature(key, expires)}`;
  }

  /** Checks a signed URL's parts. */
  verify(key: string, expires: number, sig: string): boolean {
    if (!Number.isSafeInteger(expires) || expires < this.clock().getTime() / 1000) return false;
    const expected = Buffer.from(this.signature(key, expires));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}
