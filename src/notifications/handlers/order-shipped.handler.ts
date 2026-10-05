import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TOPICS, type TypedEventEnvelope } from '@us-man-qa-sim/ecom-contracts/events';
import type { TopicHandler } from '../../kafka/consumer';
import { KafkaConsumerService } from '../../kafka/kafka-consumer.service';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class OrderShippedHandler
  implements TopicHandler<'order.shipped'>, OnModuleInit
{
  private readonly logger = new Logger(OrderShippedHandler.name);

  constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.consumer.subscribe(TOPICS.ORDER_SHIPPED, this);
  }

  async handle(event: TypedEventEnvelope<'order.shipped'>): Promise<void> {
    const { eventId, payload } = event;
    const { orderId, userId } = payload;

    const created = await this.notifications.createPending({
      eventId,
      userId,
      orderId,
      type: TOPICS.ORDER_SHIPPED,
    });

    if (created) {
      this.logger.log({ eventId, orderId, userId }, 'order.shipped notification queued');
    }
  }
}
