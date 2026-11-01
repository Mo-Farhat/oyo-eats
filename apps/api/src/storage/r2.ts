import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertKey, type FileStorage } from './storage.js';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Cloudflare R2 (S3-compatible) for production (SEC-17): a private bucket; clients only get
 * presigned GET links that expire. Setup: docs/SETUP-PROVIDERS.md.
 */
export class R2Storage implements FileStorage {
  private readonly s3: S3Client;

  constructor(private readonly config: R2Config) {
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertKey(key);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string) {
    assertKey(key);
    try {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const bytes = await out.Body?.transformToByteArray();
      return bytes
        ? { data: Buffer.from(bytes), contentType: out.ContentType ?? 'application/octet-stream' }
        : null;
    } catch {
      return null;
    }
  }

  signedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertKey(key);
    return getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
}
