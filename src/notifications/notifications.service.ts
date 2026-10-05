import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Notification,
  NotificationChannel,
  NotificationDocument,
  NotificationStatus,
} from './notification.schema';

export interface CreateNotificationInput {
  eventId: string;
  userId: string;
  orderId: string | null;
  type: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private readonly model: Model<NotificationDocument>,
  ) {}

  /**
   * Inserts a PENDING notification record. Returns true when inserted, false when
   * the eventId already exists (duplicate Kafka delivery — safe no-op). Throws on
   * any other DB error.
   */
  async createPending(input: CreateNotificationInput): Promise<boolean> {
    try {
      await this.model.create({
        eventId: input.eventId,
        userId: input.userId,
        orderId: input.orderId,
        type: input.type,
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.PENDING,
        attempts: 0,
        lastError: null,
        sentAt: null,
      });
      return true;
    } catch (err: unknown) {
      if (isDuplicateKey(err)) {
        this.logger.log({ eventId: input.eventId }, 'Duplicate event — notification already queued');
        return false;
      }
      throw err;
    }
  }
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}
