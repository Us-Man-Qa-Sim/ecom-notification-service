import { Test, TestingModule } from '@nestjs/testing';
import { TOPICS } from '@us-man-qa-sim/ecom-contracts/events';
import type { TypedEventEnvelope } from '@us-man-qa-sim/ecom-contracts/events';
import { KafkaConsumerService } from '../../kafka/kafka-consumer.service';
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

  it('delegates to NotificationsService.createAndSend with the correct payload', async () => {
    const event: TypedEventEnvelope<'user.registered'> = {
      eventId: 'evt-reg-1',
      topic: TOPICS.USER_REGISTERED,
      occurredAt: new Date().toISOString(),
      payload: {
        userId: 'u-1',
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
      },
    };

    await handler.handle(event);

    expect(mockNotifications.createAndSend).toHaveBeenCalledWith({
      eventId: 'evt-reg-1',
      userId: 'u-1',
      orderId: null,
      type: TOPICS.USER_REGISTERED,
      email: 'alice@example.com',
      firstName: 'Alice',
    });
  });
});
