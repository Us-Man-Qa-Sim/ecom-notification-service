import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TOPICS, type TypedEventEnvelope } from '@us-man-qa-sim/ecom-contracts/events';
import type { TopicHandler } from '../../kafka/consumer';
import { KafkaConsumerService } from '../../kafka/kafka-consumer.service';
import { NotificationType } from '../notification.schema';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class OrderConfirmedHandler implements TopicHandler<'order.confirmed'>, OnModuleInit {
  private readonly logger = new Logger(OrderConfirmedHandler.name);

  constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.consumer.subscribe(TOPICS.ORDER_CONFIRMED, this);
  }

  async handle(event: TypedEventEnvelope<'order.confirmed'>): Promise<void> {
    const { eventId, payload } = event;
    const { orderId, userId } = payload;

    this.logger.log({ eventId, orderId, userId }, 'Handling order.confirmed');

    await this.notifications.createAndSend({
      eventId,
      userId,
      orderId,
      type: NotificationType.ORDER_CONFIRMED,
    });
  }
}
