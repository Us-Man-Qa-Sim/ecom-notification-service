import 'reflect-metadata';
import mongoose from 'mongoose';
import { validateEnv } from '../config/env.validation';
import { Notification, NotificationSchema } from '../notifications/notification.schema';

/**
 * Index migration (mirrors product-service PRD-3).
 *
 * Production runs with `autoIndex: false` (see database.module.ts), so
 * schema-declared indexes never build on their own — including the unique
 * `eventId` index that *is* the inbox (NTF-6). Without it, a redelivered Kafka
 * message would insert a second row and send a duplicate email. This script
 * drives the indexes explicitly: `syncIndexes()` creates every index declared
 * on the schema and drops any the schema no longer declares. It is idempotent,
 * so the Docker entrypoint runs it on every start before the service boots.
 */

export const MODELS = [{ name: Notification.name, schema: NotificationSchema }] as const;

async function main(): Promise<void> {
  const env = validateEnv(process.env);

  const connection = await mongoose
    .createConnection(env.MONGO_URI, { autoIndex: false })
    .asPromise();

  try {
    for (const { name, schema } of MODELS) {
      const model = connection.model(name, schema);
      const dropped = await model.syncIndexes();
      const note = dropped.length ? `dropped stale ${JSON.stringify(dropped)}` : 'up to date';
      console.log(`[sync-indexes] ${name}: ${note}`);
    }
    console.log('[sync-indexes] done');
  } finally {
    await connection.close();
  }
}

// Self-invoke only as the program entry point (`node dist/scripts/sync-indexes.js`
// from the Docker entrypoint) so tests can import MODELS without connecting.
if (require.main === module) {
  main().catch((err) => {
    console.error('[sync-indexes] failed', err);
    process.exit(1);
  });
}
