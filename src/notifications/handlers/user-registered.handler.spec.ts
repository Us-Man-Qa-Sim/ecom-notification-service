import { Test, TestingModule } from '@nestjs/testing';
import { TOPICS } from '@us-man-qa-sim/ecom-contracts/events';
import type { TypedEventEnvelope } from '@us-man-qa-sim/ecom-contracts/events';
import { KafkaConsumerService } from '../../kafka/kafka-consumer.service';
import { NotificationType } from '../notification.schema';
import { NotificationsService } from '../notifications.service';
import { UserRegisteredHandler } from './user-registered.handler';

describe('UserRegisteredHandler', () => {
  let handler: UserRegisteredHandler;

  const mockConsumer = { subscribe: jest.fn() };
  const mockNotifications = { createAndSend: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserRegisteredHandler,
        { provide: KafkaConsumerService, useValue: mockConsumer },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    handler = module.get(UserRegisteredHandler);
  });

  it('subscribes to the user.registered topic on init', () => {
    handler.onModuleInit();
    expect(mockConsumer.subscribe).toHaveBeenCalledWith(TOPICS.USER_REGISTERED, handler);
  });

  it('sends a WELCOME notification using the email from the payload', async () => {
    const event: TypedEventEnvelope<'user.registered'> = {
      eventId: '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b',
      eventType: TOPICS.USER_REGISTERED,
      version: 1,
      occurredAt: new Date().toISOString(),
      correlationId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      payload: {
        userId: 'u-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
      },
    };

    await handler.handle(event);

    expect(mockNotifications.createAndSend).toHaveBeenCalledWith({
      eventId: event.eventId,
      userId: 'u-1',
      orderId: null,
      type: NotificationType.WELCOME,
      recipient: { email: 'alice@example.com', firstName: 'Alice' },
    });
  });
});
