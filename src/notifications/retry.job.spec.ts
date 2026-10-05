import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { NotificationStatus, NotificationType } from './notification.schema';
import { NotificationsService } from './notifications.service';
import { RETRY_INTERVAL_NAME, RetryJob } from './retry.job';

type Row = Parameters<NotificationsService['retryOne']>[0];

function makeRow(id = 'aaa'): Row {
  return {
    _id: new Types.ObjectId(id.padStart(24, '0')),
    userId: 'user-1',
    orderId: null,
    type: NotificationType.ORDER_CONFIRMED,
    reason: null,
    status: NotificationStatus.FAILED,
    updatedAt: new Date(),
  };
}

const CONFIG: Record<string, number> = {
  NOTIFICATION_RETRY_MAX_ATTEMPTS: 5,
  NOTIFICATION_RETRY_INTERVAL_MS: 15_000,
  NOTIFICATION_RETRY_BASE_DELAY_MS: 60_000,
  NOTIFICATION_PENDING_STALE_MS: 300_000,
};

describe('RetryJob', () => {
  let job: RetryJob;
  let scheduler: SchedulerRegistry;

  const mockNotifications = {
    findEligibleForRetry: jest.fn(),
    retryOne: jest.fn(),
  };

  const mockConfig = { get: jest.fn((key: string) => CONFIG[key]) };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetryJob,
        SchedulerRegistry,
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    job = module.get(RetryJob);
    scheduler = module.get(SchedulerRegistry);
  });

  afterEach(() => {
    job.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('schedules itself with NOTIFICATION_RETRY_INTERVAL_MS and clears on shutdown', () => {
    jest.useFakeTimers();
    mockNotifications.findEligibleForRetry.mockResolvedValue([]);

    job.onApplicationBootstrap();
    expect(scheduler.doesExist('interval', RETRY_INTERVAL_NAME)).toBe(true);

    jest.advanceTimersByTime(14_999);
    expect(mockNotifications.findEligibleForRetry).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(mockNotifications.findEligibleForRetry).toHaveBeenCalledTimes(1);

    job.onApplicationShutdown();
    expect(scheduler.doesExist('interval', RETRY_INTERVAL_NAME)).toBe(false);
  });

  it('passes the retry policy with a stale-PENDING cutoff of now − NOTIFICATION_PENDING_STALE_MS', async () => {
    const now = new Date('2026-10-05T10:00:00Z');
    jest.useFakeTimers({ now });
    mockNotifications.findEligibleForRetry.mockResolvedValue([]);

    await job.run();

    expect(mockNotifications.findEligibleForRetry).toHaveBeenCalledWith(
      {
        maxAttempts: 5,
        baseDelayMs: 60_000,
        staleBefore: new Date('2026-10-05T09:55:00Z'),
      },
      now,
    );
  });

  it('calls retryOne for each eligible document', async () => {
    const docs = [makeRow('aaa'), makeRow('bbb')];
    mockNotifications.findEligibleForRetry.mockResolvedValue(docs);
    mockNotifications.retryOne.mockResolvedValue(undefined);

    await job.run();

    expect(mockNotifications.retryOne).toHaveBeenCalledTimes(2);
    expect(mockNotifications.retryOne).toHaveBeenCalledWith(docs[0]);
    expect(mockNotifications.retryOne).toHaveBeenCalledWith(docs[1]);
  });

  it('does nothing when there are no eligible documents', async () => {
    mockNotifications.findEligibleForRetry.mockResolvedValue([]);

    await job.run();

    expect(mockNotifications.retryOne).not.toHaveBeenCalled();
  });

  it('continues when one retryOne call rejects (allSettled)', async () => {
    const docs = [makeRow('aaa'), makeRow('bbb')];
    mockNotifications.findEligibleForRetry.mockResolvedValue(docs);
    mockNotifications.retryOne
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(job.run()).resolves.toBeUndefined();
    expect(mockNotifications.retryOne).toHaveBeenCalledTimes(2);
  });

  it('skips execution when a previous tick is still in progress', async () => {
    let resolve!: () => void;
    const blocker = new Promise<void>((res) => {
      resolve = res;
    });

    mockNotifications.findEligibleForRetry.mockResolvedValue([makeRow('aaa')]);
    mockNotifications.retryOne.mockReturnValueOnce(blocker);

    // Start first tick and don't await it
    const first = job.run();

    // Second tick should return immediately without calling findEligibleForRetry again
    await job.run();
    expect(mockNotifications.findEligibleForRetry).toHaveBeenCalledTimes(1);

    resolve();
    await first;
  });
});
