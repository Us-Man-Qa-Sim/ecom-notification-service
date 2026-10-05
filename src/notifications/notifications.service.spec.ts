import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Metadata } from '@grpc/grpc-js';
import { Types } from 'mongoose';
import { Notification, NotificationStatus, NotificationType } from './notification.schema';
import {
  NotificationsService,
  RETRY_BATCH_SIZE,
  RETRY_MAX_DELAY_MS,
  SendNotificationInput,
  retryDelayMs,
} from './notifications.service';
import { MailerService } from '../mailer/mailer.service';
import { UserGrpcClient } from '../grpc/user.client';
import { GrpcCallTimeouts } from '../grpc/grpc-call.util';
import { CorrelationService } from '../correlation/correlation.service';

// Replace callGrpc with a controllable mock while preserving the rest of the module.
jest.mock('../grpc/grpc-call.util', () => ({
  callGrpc: jest.fn(),
  GrpcCallTimeouts: class {
    fast = 2_000;
    standard = 5_000;
    long = 10_000;
  },
}));

// Import AFTER the mock is registered so the mock is in place.
import { callGrpc } from '../grpc/grpc-call.util';

const mockCallGrpc = callGrpc as jest.MockedFunction<typeof callGrpc>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Row = Parameters<NotificationsService['retryOne']>[0];

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    _id: new Types.ObjectId(),
    userId: 'user-1',
    orderId: 'ord-1',
    type: NotificationType.ORDER_CONFIRMED,
    reason: null,
    status: NotificationStatus.FAILED,
    updatedAt: new Date('2026-10-05T10:00:00Z'),
    ...overrides,
  };
}

function makeInput(overrides: Partial<SendNotificationInput> = {}): SendNotificationInput {
  return {
    eventId: 'evt-1',
    userId: 'user-1',
    orderId: 'ord-1',
    type: NotificationType.ORDER_CONFIRMED,
    recipient: { email: 'alice@example.com', firstName: 'Alice' },
    ...overrides,
  };
}

/** Chainable stand-in for `model.find()/findOneAndUpdate()` query builders. */
interface MockQuery {
  sort: jest.Mock<MockQuery>;
  limit: jest.Mock<MockQuery>;
  lean: jest.Mock<MockQuery>;
  exec: jest.Mock;
}

function query(result: unknown): MockQuery {
  const q: MockQuery = {
    sort: jest.fn(() => q),
    limit: jest.fn(() => q),
    lean: jest.fn(() => q),
    exec: jest.fn().mockResolvedValue(result),
  };
  return q;
}

const E11000 = Object.assign(new Error('dup key'), { code: 11000 });

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockModel = {
    create: jest.fn(),
    updateOne: jest.fn(),
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };

  const mockMailer: Pick<MailerService, 'send'> = {
    send: jest.fn(),
  };

  const mockUserClient = {
    service: { getUser: jest.fn() },
  };

  const mockCorrelation = { getCorrelationId: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockModel.updateOne.mockResolvedValue({});
    mockCorrelation.getCorrelationId.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: mockModel },
        { provide: MailerService, useValue: mockMailer },
        { provide: UserGrpcClient, useValue: mockUserClient },
        { provide: CorrelationService, useValue: mockCorrelation },
        GrpcCallTimeouts,
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  function lastSetStatus(): NotificationStatus | undefined {
    const call = mockModel.updateOne.mock.calls.at(-1);
    return call?.[1]?.$set?.status;
  }

  // -------------------------------------------------------------------------
  // createAndSend
  // -------------------------------------------------------------------------

  describe('createAndSend', () => {
    it('inserts PENDING, sends email, and marks SENT on the happy path', async () => {
      const doc = makeRow({ status: NotificationStatus.PENDING });
      mockModel.create.mockResolvedValue(doc);
      (mockMailer.send as jest.Mock).mockResolvedValue(undefined);

      await service.createAndSend(makeInput());

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'evt-1',
          type: NotificationType.ORDER_CONFIRMED,
          status: NotificationStatus.PENDING,
        }),
      );
      expect(mockMailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@example.com' }),
      );
      expect(mockCallGrpc).not.toHaveBeenCalled();
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({
          $set: expect.objectContaining({ status: NotificationStatus.SENT }),
          $inc: { attempts: 1 },
        }),
      );
    });

    it('persists the cancellation reason so a retry can re-render it', async () => {
      mockModel.create.mockResolvedValue(makeRow({ status: NotificationStatus.PENDING }));
      (mockMailer.send as jest.Mock).mockResolvedValue(undefined);

      await service.createAndSend(
        makeInput({ type: NotificationType.ORDER_CANCELLED, reason: 'Out of stock' }),
      );

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'Out of stock' }),
      );
    });

    it('treats a duplicate-key error (E11000) as a no-op', async () => {
      mockModel.create.mockRejectedValue(E11000);

      await expect(service.createAndSend(makeInput())).resolves.toBeUndefined();
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('re-throws non-duplicate errors from the initial insert', async () => {
      mockModel.create.mockRejectedValue(new Error('network error'));

      await expect(service.createAndSend(makeInput())).rejects.toThrow('network error');
    });

    it('resolves the recipient via gRPC with identity metadata for the target user', async () => {
      mockModel.create.mockResolvedValue(makeRow({ status: NotificationStatus.PENDING }));
      (mockMailer.send as jest.Mock).mockResolvedValue(undefined);
      mockCallGrpc.mockResolvedValue({ user: { email: 'bob@example.com', firstName: 'Bob' } });
      mockCorrelation.getCorrelationId.mockReturnValue('corr-1');

      await service.createAndSend(makeInput({ recipient: undefined }));

      // GetUser rejects calls without x-user-id/x-user-role (UNAUTHENTICATED);
      // acting as the user themself satisfies its self-or-admin check.
      expect(mockUserClient.service.getUser).toHaveBeenCalledWith(
        { userId: 'user-1' },
        expect.any(Metadata),
      );
      const metadata = mockUserClient.service.getUser.mock.calls[0][1] as Metadata;
      expect(metadata.get('x-user-id')).toEqual(['user-1']);
      expect(metadata.get('x-user-role')).toEqual(['CUSTOMER']);
      expect(metadata.get('x-request-id')).toEqual(['corr-1']);
      expect(mockMailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'bob@example.com' }),
      );
    });

    it('marks FAILED when gRPC lookup throws', async () => {
      const doc = makeRow({ status: NotificationStatus.PENDING });
      mockModel.create.mockResolvedValue(doc);
      mockCallGrpc.mockRejectedValue(new Error('grpc down'));

      await service.createAndSend(makeInput({ recipient: undefined }));

      expect(mockMailer.send).not.toHaveBeenCalled();
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: NotificationStatus.FAILED,
            lastError: 'grpc down',
          }),
        }),
      );
    });

    it('marks FAILED when SMTP throws', async () => {
      const doc = makeRow({ status: NotificationStatus.PENDING });
      mockModel.create.mockResolvedValue(doc);
      (mockMailer.send as jest.Mock).mockRejectedValue(new Error('smtp error'));

      await service.createAndSend(makeInput());

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: NotificationStatus.FAILED,
            lastError: 'smtp error',
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // retryOne
  // -------------------------------------------------------------------------

  describe('retryOne', () => {
    it('claims the row with a compare-and-set on status + updatedAt', async () => {
      const doc = makeRow();
      mockModel.findOneAndUpdate.mockReturnValue(query(null));

      await service.retryOne(doc);

      expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: doc._id, status: NotificationStatus.FAILED, updatedAt: doc.updatedAt },
        { $set: { status: NotificationStatus.PENDING, updatedAt: expect.any(Date) } },
        expect.objectContaining({ returnDocument: 'after', timestamps: false }),
      );
    });

    it('does nothing when another tick/instance already claimed the row', async () => {
      mockModel.findOneAndUpdate.mockReturnValue(query(null));

      await service.retryOne(makeRow());

      expect(mockCallGrpc).not.toHaveBeenCalled();
      expect(mockMailer.send).not.toHaveBeenCalled();
      expect(mockModel.updateOne).not.toHaveBeenCalled();
    });

    it('resolves email, sends, and marks SENT on the happy path', async () => {
      const doc = makeRow();
      mockModel.findOneAndUpdate.mockReturnValue(
        query({ ...doc, status: NotificationStatus.PENDING }),
      );
      (mockMailer.send as jest.Mock).mockResolvedValue(undefined);
      mockCallGrpc.mockResolvedValue({ user: { email: 'carol@example.com', firstName: 'Carol' } });

      await service.retryOne(doc);

      expect(mockMailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'carol@example.com' }),
      );
      expect(lastSetStatus()).toBe(NotificationStatus.SENT);
    });

    it('re-renders the stored cancellation reason', async () => {
      const doc = makeRow({ type: NotificationType.ORDER_CANCELLED, reason: 'Out of stock' });
      mockModel.findOneAndUpdate.mockReturnValue(query(doc));
      (mockMailer.send as jest.Mock).mockResolvedValue(undefined);
      mockCallGrpc.mockResolvedValue({ user: { email: 'erin@example.com', firstName: 'Erin' } });

      await service.retryOne(doc);

      expect(mockMailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ html: expect.stringContaining('Out of stock') }),
      );
    });

    it('marks FAILED when gRPC fails', async () => {
      const doc = makeRow();
      mockModel.findOneAndUpdate.mockReturnValue(query(doc));
      mockCallGrpc.mockRejectedValue(new Error('grpc timeout'));

      await service.retryOne(doc);

      expect(mockMailer.send).not.toHaveBeenCalled();
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: NotificationStatus.FAILED,
            lastError: 'grpc timeout',
          }),
        }),
      );
    });

    it('marks FAILED when SMTP fails', async () => {
      const doc = makeRow();
      mockModel.findOneAndUpdate.mockReturnValue(query(doc));
      mockCallGrpc.mockResolvedValue({ user: { email: 'dave@example.com', firstName: 'Dave' } });
      (mockMailer.send as jest.Mock).mockRejectedValue(new Error('mailbox full'));

      await service.retryOne(doc);

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: NotificationStatus.FAILED,
            lastError: 'mailbox full',
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // findEligibleForRetry
  // -------------------------------------------------------------------------

  describe('findEligibleForRetry', () => {
    it('queries FAILED rows past their per-attempt backoff and stale PENDING rows, oldest first', async () => {
      const q = query([]);
      mockModel.find.mockReturnValue(q);
      const now = new Date('2026-10-05T10:00:00Z');
      const staleBefore = new Date('2026-10-05T09:55:00Z');
      const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

      await service.findEligibleForRetry({ maxAttempts: 5, baseDelayMs: 60_000, staleBefore }, now);

      const failed = (attempts: number, waitedMin: number) => ({
        status: NotificationStatus.FAILED,
        attempts,
        updatedAt: { $lte: minutesAgo(waitedMin) },
      });
      expect(mockModel.find).toHaveBeenCalledWith({
        $or: [
          failed(1, 1),
          failed(2, 2),
          failed(3, 4),
          failed(4, 8),
          {
            status: NotificationStatus.PENDING,
            attempts: { $lt: 5 },
            updatedAt: { $lt: staleBefore },
          },
        ],
      });
      expect(q.sort).toHaveBeenCalledWith({ updatedAt: 1 });
      expect(q.limit).toHaveBeenCalledWith(RETRY_BATCH_SIZE);
    });
  });

  describe('retryDelayMs', () => {
    it('doubles per failed attempt and caps at RETRY_MAX_DELAY_MS', () => {
      expect(retryDelayMs(1, 60_000)).toBe(60_000);
      expect(retryDelayMs(4, 60_000)).toBe(480_000);
      expect(retryDelayMs(20, 60_000)).toBe(RETRY_MAX_DELAY_MS);
    });
  });
});
