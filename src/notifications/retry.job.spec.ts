import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { NotificationDocument } from './notification.schema';
import { NotificationStatus } from './notification.schema';
import { NotificationsService } from './notifications.service';
import { RetryJob } from './retry.job';
import { Types } from 'mongoose';

function makeDoc(id = 'aaa'): NotificationDocument {
  return {
    _id: new Types.ObjectId(id.padStart(24, '0')),
    eventId: `evt-${id}`,
    userId: 'user-1',
    orderId: null,
    type: 'order.confirmed',
    status: NotificationStatus.FAILED,
    attempts: 1,
    lastError: 'prev',
    sentAt: null,
  } as unknown as NotificationDocument;
}

describe('RetryJob', () => {
  let job: RetryJob;

  const mockNotifications = {
    findEligibleForRetry: jest.fn(),
    retryOne: jest.fn(),
  };

  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'NOTIFICATION_RETRY_MAX_ATTEMPTS') return 5;
      return undefined;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetryJob,
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    job = module.get(RetryJob);
  });

  it('calls retryOne for each eligible document', async () => {
    const docs = [makeDoc('aaa'), makeDoc('bbb')];
    mockNotifications.findEligibleForRetry.mockResolvedValue(docs);
    mockNotifications.retryOne.mockResolvedValue(undefined);

    await job.run();

    expect(mockNotifications.findEligibleForRetry).toHaveBeenCalledWith(5);
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
    const docs = [makeDoc('aaa'), makeDoc('bbb')];
    mockNotifications.findEligibleForRetry.mockResolvedValue(docs);
    mockNotifications.retryOne
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(job.run()).resolves.toBeUndefined();
    expect(mockNotifications.retryOne).toHaveBeenCalledTimes(2);
  });

  it('skips execution when a previous tick is still in progress', async () => {
    let resolve!: () => void;
    const blocker = new Promise<void>((res) => { resolve = res; });

    mockNotifications.findEligibleForRetry.mockResolvedValue([makeDoc('aaa')]);
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
