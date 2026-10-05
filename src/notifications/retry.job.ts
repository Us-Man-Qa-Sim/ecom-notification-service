import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { Env } from '../config/env.validation';
import { NotificationsService } from './notifications.service';

export const RETRY_INTERVAL_NAME = 'notification-retry';

@Injectable()
export class RetryJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RetryJob.name);
  private readonly maxAttempts: number;
  private readonly intervalMs: number;
  private readonly baseDelayMs: number;
  private readonly pendingStaleMs: number;
  private running = false;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly scheduler: SchedulerRegistry,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('NOTIFICATION_RETRY_MAX_ATTEMPTS', { infer: true });
    this.intervalMs = config.get('NOTIFICATION_RETRY_INTERVAL_MS', { infer: true });
    this.baseDelayMs = config.get('NOTIFICATION_RETRY_BASE_DELAY_MS', { infer: true });
    this.pendingStaleMs = config.get('NOTIFICATION_PENDING_STALE_MS', { infer: true });
  }

  // Registered dynamically rather than with `@Interval()`, whose period must be
  // a compile-time constant — this way NOTIFICATION_RETRY_INTERVAL_MS applies.
  onApplicationBootstrap(): void {
    const handle = setInterval(() => void this.run(), this.intervalMs);
    this.scheduler.addInterval(RETRY_INTERVAL_NAME, handle);
    this.logger.log(
      { intervalMs: this.intervalMs, maxAttempts: this.maxAttempts },
      'Notification retry job scheduled',
    );
  }

  onApplicationShutdown(): void {
    if (this.scheduler.doesExist('interval', RETRY_INTERVAL_NAME)) {
      this.scheduler.deleteInterval(RETRY_INTERVAL_NAME);
    }
  }

  async run(): Promise<void> {
    if (this.running) return; // skip if a previous tick is still in progress
    this.running = true;

    try {
      const now = new Date();
      const docs = await this.notifications.findEligibleForRetry(
        {
          maxAttempts: this.maxAttempts,
          baseDelayMs: this.baseDelayMs,
          staleBefore: new Date(now.getTime() - this.pendingStaleMs),
        },
        now,
      );
      if (docs.length === 0) return;

      this.logger.log({ count: docs.length }, 'Retrying FAILED / stale PENDING notifications');

      await Promise.allSettled(docs.map((doc) => this.notifications.retryOne(doc)));
    } catch (err: unknown) {
      this.logger.error({ err }, 'RetryJob tick failed unexpectedly');
    } finally {
      this.running = false;
    }
  }
}
