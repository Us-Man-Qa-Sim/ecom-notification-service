import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TOPICS, type TypedEventEnvelope } from '@us-man-qa-sim/ecom-contracts/events';
import type { TopicHandler } from '../../kafka/consumer';
import { KafkaConsumerService } from '../../kafka/kafka-consumer.service';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class OrderConfirmedHandler
  implements TopicHandler<'order.confirmed'>, OnModuleInit
{
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

    const created = await this.notifications.createPending({
      eventId,
      userId,
      orderId,
      type: TOPICS.ORDER_CONFIRMED,
    });

    if (created) {
      this.logger.log({ eventId, orderId, userId }, 'order.confirmed notification queued');
    }
  }
}
