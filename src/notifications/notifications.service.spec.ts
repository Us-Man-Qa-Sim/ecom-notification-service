import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { NotificationDocument } from './notification.schema';
import { Notification, NotificationStatus } from './notification.schema';
import { NotificationsService, SendNotificationInput } from './notifications.service';
import { MailerService } from '../mailer/mailer.service';
import { UserGrpcClient } from '../grpc/user.client';
import { GrpcCallTimeouts } from '../grpc/grpc-call.util';

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

function makeDoc(overrides: Partial<NotificationDocument> = {}): NotificationDocument {
  return {
    _id: new Types.ObjectId(),
    eventId: 'evt-1',
    userId: 'user-1',
    orderId: 'ord-1',
    type: 'order.confirmed',
    status: NotificationStatus.FAILED,
    attempts: 1,
    lastError: 'previous error',
    sentAt: null,
    ...overrides,
  } as unknown as NotificationDocument;
}

function makeInput(overrides: Partial<SendNotificationInput> = {}): SendNotificationInput {
  return {
    eventId: 'evt-1',
    userId: 'user-1',
    orderId: 'ord-1',
    type: 'order.confirmed',
    email: 'alice@example.com',
    firstName: 'Alice',
    ...overrides,
  };
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
  };

  const mockMailer: Pick<MailerService, 'send'> = {
    send: jest.fn(),
  };

  const mockUserClient = {
    service: { getUser: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    (mockModel.updateOne as jest.Mock).mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: mockModel },
        { provide: MailerService, useValue: mockMailer },
        { provide: UserGrpcClient, useValue: mockUserClient },
        GrpcCallTimeouts,
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  // -------------------------------------------------------------------------
  // createAndSend
  // -------------------------------------------------------------------------

  describe('createAndSend', () => {
    it('inserts PENDING, sends email, and marks SENT on the happy path', async () => {
      const doc = makeDoc({ status: NotificationStatus.PENDING, attempts: 0 });
      (mockModel.create as jest.Mock).mockResolvedValue(doc);
      (mockMailer.send as jest.Mock).mockResolvedValue(undefined);

      await service.createAndSend(makeInput());

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'evt-1', status: NotificationStatus.PENDING }),
      );
      expect(mockMailer.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'alice@example.com' }),
      );
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({ $set: expect.objectContaining({ status: NotificationStatus.SENT }) }),
      );
    });

    it('treats a duplicate-key error (E11000) as a no-op', async () => {
      (mockModel.create as jest.Mock).mockRejectedValue(E11000);

      await expect(service.createAndSend(makeInput())).resolves.toBeUndefined();
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('re-throws non-duplicate errors from the initial insert', async () => {
      (mockModel.create as jest.Mock).mockRejectedValue(new Error('network error'));

      await expect(service.createAndSend(makeInput())).rejects.toThrow('network error');
    });

    it('resolves the recipient via gRPC when email is not pre-provided', async () => {
      const doc = makeDoc({ status: NotificationStatus.PENDING, attempts: 0 });
      (mockModel.create as jest.Mock).mockResolvedValue(doc);
      (mockMailer.send as jest.Mock).mockResolvedValue(undefined);
      mockCallGrpc.mockResolvedValue({ user: { email: 'bob@example.com', firstName: 'Bob' } });

      const input = makeInput({ email: undefined, firstName: undefined });
      await service.createAndSend(input);

      expect(mockCallGrpc).toHaveBeenCalled();
      expect(mockMailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'bob@example.com' }));
    });

    it('marks FAILED when gRPC lookup throws', async () => {
      const doc = makeDoc({ status: NotificationStatus.PENDING, attempts: 0 });
      (mockModel.create as jest.Mock).mockResolvedValue(doc);
      mockCallGrpc.mockRejectedValue(new Error('grpc down'));

      const input = makeInput({ email: undefined, firstName: undefined });
      await service.createAndSend(input);

      expect(mockMailer.send).not.toHaveBeenCalled();
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({ $set: expect.objectContaining({ status: NotificationStatus.FAILED }) }),
      );
    });

    it('marks FAILED when SMTP throws', async () => {
      const doc = makeDoc({ status: NotificationStatus.PENDING, attempts: 0 });
      (mockModel.create as jest.Mock).mockResolvedValue(doc);
      (mockMailer.send as jest.Mock).mockRejectedValue(new Error('smtp error'));

      await service.createAndSend(makeInput());

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({ $set: expect.objectContaining({ status: NotificationStatus.FAILED, lastError: 'smtp error' }) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // retryOne
  // -------------------------------------------------------------------------

  describe('retryOne', () => {
    it('resolves email, sends, and marks SENT on the happy path', async () => {
      const doc = makeDoc();
      (mockMailer.send as jest.Mock).mockResolvedValue(undefined);
      mockCallGrpc.mockResolvedValue({ user: { email: 'carol@example.com', firstName: 'Carol' } });

      await service.retryOne(doc);

      expect(mockMailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'carol@example.com' }));
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({ $set: expect.objectContaining({ status: NotificationStatus.SENT }) }),
      );
    });

    it('marks FAILED when gRPC fails', async () => {
      const doc = makeDoc();
      mockCallGrpc.mockRejectedValue(new Error('grpc timeout'));

      await service.retryOne(doc);

      expect(mockMailer.send).not.toHaveBeenCalled();
      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({ $set: expect.objectContaining({ status: NotificationStatus.FAILED, lastError: 'grpc timeout' }) }),
      );
    });

    it('marks FAILED when SMTP fails', async () => {
      const doc = makeDoc();
      mockCallGrpc.mockResolvedValue({ user: { email: 'dave@example.com', firstName: 'Dave' } });
      (mockMailer.send as jest.Mock).mockRejectedValue(new Error('mailbox full'));

      await service.retryOne(doc);

      expect(mockModel.updateOne).toHaveBeenCalledWith(
        { _id: doc._id },
        expect.objectContaining({ $set: expect.objectContaining({ status: NotificationStatus.FAILED, lastError: 'mailbox full' }) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // findEligibleForRetry
  // -------------------------------------------------------------------------

  describe('findEligibleForRetry', () => {
    it('queries for FAILED docs with attempts < maxAttempts', async () => {
      const execMock = jest.fn().mockResolvedValue([]);
      const leanMock = jest.fn().mockReturnValue({ exec: execMock });
      const limitMock = jest.fn().mockReturnValue({ lean: leanMock });
      (mockModel.find as jest.Mock).mockReturnValue({ limit: limitMock });

      await service.findEligibleForRetry(5);

      expect(mockModel.find).toHaveBeenCalledWith({
        status: NotificationStatus.FAILED,
        attempts: { $lt: 5 },
      });
      expect(limitMock).toHaveBeenCalledWith(100);
    });
  });
});
