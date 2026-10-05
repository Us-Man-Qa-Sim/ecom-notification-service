import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TOPICS, type TypedEventEnvelope } from '@us-man-qa-sim/ecom-contracts/events';
import type { TopicHandler } from '../../kafka/consumer';
import { KafkaConsumerService } from '../../kafka/kafka-consumer.service';
import { NotificationType } from '../notification.schema';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class OrderCancelledHandler implements TopicHandler<'order.cancelled'>, OnModuleInit {
  private readonly logger = new Logger(OrderCancelledHandler.name);

  constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.consumer.subscribe(TOPICS.ORDER_CANCELLED, this);
  }

  async handle(event: TypedEventEnvelope<'order.cancelled'>): Promise<void> {
    const { eventId, payload } = event;
    const { orderId, userId, reason } = payload;

    this.logger.log({ eventId, orderId, userId }, 'Handling order.cancelled');

    await this.notifications.createAndSend({
      eventId,
      userId,
      orderId,
      type: NotificationType.ORDER_CANCELLED,
      reason,
    });
  }
}
