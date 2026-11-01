import { randomBytes } from 'node:crypto';
import { TransactionRollbackError } from 'drizzle-orm';
import type { Config } from '../config.js';
import { createDb, createPool, type Db, type Tx } from './client.js';

try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

/** The test database, or undefined when DATABASE_URL isn't set (tests then skip). */
export const testDatabaseUrl = process.env.DATABASE_URL;

let db: Db | undefined;
let pool: ReturnType<typeof createPool> | undefined;

export function testDb(): Db {
  if (!testDatabaseUrl) throw new Error('DATABASE_URL is not set');
  pool ??= createPool(testDatabaseUrl);
  db ??= createDb(pool);
  return db;
}

export async function closeTestDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

/** Runs `work` inside a transaction that is always rolled back, so tests leave no rows. */
export async function inRollback(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await testDb().transaction(async (tx) => {
      await work(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

/** Config for tests: the test database and throwaway keys. */
export function testConfig(): Config {
  return {
    env: 'test',
    port: 0,
    databaseUrl: testDatabaseUrl ?? '',
    hashKey: randomBytes(32),
    encryptionKey: randomBytes(32),
    trustProxy: 0,
    publicUrl: 'http://test.invalid',
    uploadDir: '',
  };
}
