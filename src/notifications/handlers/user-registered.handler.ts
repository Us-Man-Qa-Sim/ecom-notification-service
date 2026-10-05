import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { TOPICS, type TypedEventEnvelope } from '@us-man-qa-sim/ecom-contracts/events';
import type { TopicHandler } from '../../kafka/consumer';
import { KafkaConsumerService } from '../../kafka/kafka-consumer.service';
import { NotificationsService } from '../notifications.service';

@Injectable()
export class UserRegisteredHandler
  implements TopicHandler<'user.registered'>, OnModuleInit
{
  private readonly logger = new Logger(UserRegisteredHandler.name);

  constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.consumer.subscribe(TOPICS.USER_REGISTERED, this);
  }

  async handle(event: TypedEventEnvelope<'user.registered'>): Promise<void> {
    const { eventId, payload } = event;
    const { userId, email, firstName } = payload;

    this.logger.log({ eventId, userId }, 'Handling user.registered');

    await this.notifications.createAndSend({
      eventId,
      userId,
      orderId: null,
      type: TOPICS.USER_REGISTERED,
      email,
      firstName,
    });
  }
}
