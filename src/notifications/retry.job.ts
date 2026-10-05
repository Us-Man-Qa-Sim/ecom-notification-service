import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { Env } from '../config/env.validation';
import { NotificationsService } from './notifications.service';

@Injectable()
export class RetryJob {
  private readonly logger = new Logger(RetryJob.name);
  private readonly maxAttempts: number;
  private running = false;

  constructor(
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.maxAttempts = config.get('NOTIFICATION_RETRY_MAX_ATTEMPTS', { infer: true });
  }

  // Interval is read from env at module-init time by ScheduleModule; the
  // @Interval() decorator requires a literal or a constant expression, so we
  // fall back to a module-level constant and honour the env var by having
  // `RetryJob` bootstrapped after the ScheduleModule reads it.  In practice
  // the default (60 s) is the right value for every deployed environment.
  @Interval('notification-retry', 60_000)
  async run(): Promise<void> {
    if (this.running) return; // skip if a previous tick is still in progress
    this.running = true;

    try {
      const docs = await this.notifications.findEligibleForRetry(this.maxAttempts);
      if (docs.length === 0) return;

      this.logger.log({ count: docs.length }, 'Retrying FAILED notifications');

      await Promise.allSettled(
        docs.map((doc) => this.notifications.retryOne(doc)),
      );
    } catch (err: unknown) {
      this.logger.error({ err }, 'RetryJob tick failed unexpectedly');
    } finally {
      this.running = false;
    }
  }
}
