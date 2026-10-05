import { Test, TestingModule } from '@nestjs/testing';
import { TOPICS, type TopicName } from '@us-man-qa-sim/ecom-contracts/events';
import { KafkaConsumerService } from '../../kafka/kafka-consumer.service';
import type { TopicHandler } from '../../kafka/consumer';
import { NotificationType } from '../notification.schema';
import { NotificationsService } from '../notifications.service';
import { OrderCancelledHandler } from './order-cancelled.handler';
import { OrderConfirmedHandler } from './order-confirmed.handler';
import { OrderDeliveredHandler } from './order-delivered.handler';
import { OrderShippedHandler } from './order-shipped.handler';

const ORDER_ID = '0b9e4c1a-7d2f-4f5e-9a51-3c6d8e2b1f00';
const USER_ID = '7c3d2e1f-0a9b-4c8d-8e7f-6a5b4c3d2e1f';

type HandlerClass = new (...args: never[]) => TopicHandler & { onModuleInit(): void };

const CASES: [string, HandlerClass, TopicName, NotificationType][] = [
  [
    'OrderConfirmedHandler',
    OrderConfirmedHandler,
    TOPICS.ORDER_CONFIRMED,
    NotificationType.ORDER_CONFIRMED,
  ],
  [
    'OrderCancelledHandler',
    OrderCancelledHandler,
    TOPICS.ORDER_CANCELLED,
    NotificationType.ORDER_CANCELLED,
  ],
  [
    'OrderShippedHandler',
    OrderShippedHandler,
    TOPICS.ORDER_SHIPPED,
    NotificationType.ORDER_SHIPPED,
  ],
  [
    'OrderDeliveredHandler',
    OrderDeliveredHandler,
    TOPICS.ORDER_DELIVERED,
    NotificationType.ORDER_DELIVERED,
  ],
];

function envelope(topic: TopicName, payload: Record<string, unknown>) {
  return {
    eventId: '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b',
    eventType: topic,
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    payload,
  } as never;
}

describe.each(CASES)('%s', (_name, HandlerCls, topic, type) => {
  let handler: InstanceType<HandlerClass>;

  const mockConsumer = { subscribe: jest.fn() };
  const mockNotifications = { createAndSend: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandlerCls,
        { provide: KafkaConsumerService, useValue: mockConsumer },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    handler = module.get(HandlerCls);
  });

  it(`subscribes to ${topic} on init`, () => {
    handler.onModuleInit();
    expect(mockConsumer.subscribe).toHaveBeenCalledWith(topic, handler);
  });

  it(`sends a ${type} notification resolved by userId`, async () => {
    await handler.handle(envelope(topic, { orderId: ORDER_ID, userId: USER_ID }));

    expect(mockNotifications.createAndSend).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b',
        userId: USER_ID,
        orderId: ORDER_ID,
        type,
      }),
    );
    // No recipient in order payloads — the service looks it up via GetUser.
    expect(mockNotifications.createAndSend.mock.calls[0][0].recipient).toBeUndefined();
  });
});

describe('OrderCancelledHandler reason', () => {
  it('forwards the cancellation reason to the template', async () => {
    const createAndSend = jest.fn().mockResolvedValue(undefined);
    const handler = new OrderCancelledHandler(
      { subscribe: jest.fn() } as unknown as KafkaConsumerService,
      { createAndSend } as unknown as NotificationsService,
    );

    await handler.handle(
      envelope(TOPICS.ORDER_CANCELLED, {
        orderId: ORDER_ID,
        userId: USER_ID,
        reason: 'Out of stock',
      }),
    );

    expect(createAndSend).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Out of stock' }));
  });
});
