import { z } from 'zod';

const numericString = (defaultValue: number) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((value, ctx) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({ code: 'custom', message: `${value} is not a number` });
        return z.NEVER;
      }
      return parsed;
    });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: numericString(8084),

  // MongoDB connection string (`notification` DB on the `rs0` replica set).
  // Indexes — including the unique `eventId` inbox index (NTF-6) — are built by
  // `sync-indexes` at container start, since production runs with autoIndex off.
  MONGO_URI: z.string().min(1),

  // Kafka consumer (no producer — this service never publishes events).
  KAFKA_BROKERS: z.string().default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().default('notification-service'),
  KAFKA_CONSUMER_GROUP_ID: z.string().default('notification-service'),
  KAFKA_CONSUMER_MAX_RETRIES: numericString(5),
  KAFKA_CONSUMER_RETRY_BASE_MS: numericString(1_000),
  KAFKA_CONSUMER_RETRY_MAX_MS: numericString(30_000),

  // SMTP relay (Mailpit in dev, real provider in prod). Used by NTF-5.
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: numericString(1025),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_FROM: z.email().default('noreply@ecom.local'),

  // gRPC address of user-service for GetUser lookups (NTF-3).
  USER_SERVICE_URL: z.string().default('localhost:5001'),

  // Retry job (NTF-7): stop retrying a FAILED notification once it has been
  // attempted this many times in total (initial attempt counts as 1).
  NOTIFICATION_RETRY_MAX_ATTEMPTS: numericString(5),
  // How often (ms) the retry job scans for eligible FAILED notifications.
  NOTIFICATION_RETRY_INTERVAL_MS: numericString(60_000),
  // Backoff before retrying a FAILED row: base after the 1st failure, doubling
  // after each further one (capped at 1 h). Defaults give 1/2/4/8 min ≈ 15 min
  // of outage tolerance across 5 attempts.
  NOTIFICATION_RETRY_BASE_DELAY_MS: numericString(60_000),
  // A PENDING row untouched for this long was abandoned (crash between insert
  // and send) and is picked up by the retry job. Must comfortably exceed one
  // delivery: gRPC GetUser timeout (5 s) + SMTP timeouts (see MailerService).
  NOTIFICATION_PENDING_STALE_MS: numericString(300_000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  return parsed.data;
}
